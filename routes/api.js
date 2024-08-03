import {Router} from 'express';
import {sequelize} from '../models/index.js';
import {Tasks, Clients, Artifacts} from "../models/index.js";
import {Sequelize, DataTypes, Op} from 'sequelize';
import { config } from '../config.js';
import fs from "fs";
import path from "path";
import { EventEmitter } from 'events';

import crypto from "crypto";

import AsyncLock from 'async-lock';

const lock = new AsyncLock();

const router = Router();

export const emitter = new EventEmitter();

function getTaskKey(namespace, id){
  return `task:${namespace}:${id}`;
}

function getTaskCreateKey(namespace, key){
  return `task:create:${namespace}:${key}`;
}

function getClientKey(namespace, id){
  return `client:${namespace}:${id}`;
}

function getCapsKey(caps = []){
  return caps.sort().join(",");
}

async function suggestTask(task){
  const clients = await Clients.findAll({
    where: {
      namespace: task.namespace
    }
  });

  for(let client of clients){
    const clientID = client.id;

    // check compat
    // client needs every flag requested by task
    if(task.flags.some(flag => !client.caps.includes(flag))){
      continue;
    }

    emitter.emit(`event:${clientID}`, {
      event: {
        type: "task_suggested",
        id: task.id,
        variant: task.variant,
        key: task.key,
        data: task.data
      }
    });
  }
}

router.get('/', (req, res) => {
    res.send('Hello from API!');
});

router.post("/tasks/pull", async (req, res) => {
    let clientID = req.body.clientID;
    let clients = clientID ? ([await Clients.findOne({
      where: {
        id: clientID
      }
    })]) : await Clients.findAll({
      where: {
        namespace: req.body.namespace || config.defaultNamespace
      }
    });

    let cache = {};
    let freq = {};
    let clientGroups = {};

    for(let client of clients){
      const clientID = client.id;
      if(await Tasks.findOne({
        // if they have at least one task, we don't suggest
        // if a client wants to process multiple tasks, they just ask for them via http api
        where: {
          completerID: clientID,
          namespace: client.namespace
        }
      })){
        continue;
      }
      let cacheKey = `${client.namespace}:${client.variant}`;
      if(freq[cacheKey]){
        freq[cacheKey]++;
        clientGroups[cacheKey].push(client);
      }else{
        freq[cacheKey] = 1;
        clientGroups[cacheKey] = [];
      }
    }
    // fill keys
    for(let key in freq){
      let [namespace, variant] = key.split(":");
      cache[key] = await Tasks.findAll({
        where: {
          namespace: namespace,
          variant: variant,
          completerID: {
            [Op.eq]: null
          }
        },
        limit: freq[key]
      });
      for(let i = 0; i < cache[key].length; i++) {
        const task = cache[key][i];
        const client = clientGroups[key][i];
        // suggest task for that client
        emitter.emit(`event:${client.id}`, {
          event: {
            type: "task_suggested",
            id: task.id,
            variant: task.variant,
            key: task.key,
            data: task.data
          }
        });
      }
    }

});
 
router.post("/tasks/create", async (req, res) => {
  const task = await lock.acquire(getTaskCreateKey(req.body.namespace, req.body.key), async () => {
    let existingTask = await Tasks.findOne({
      where: {
        key: req.body.key,
        namespace: req.body.namespace || config.defaultNamespace
      }
    });
    if(existingTask){
      return null;
    }
    const task = await Tasks.create({
      namespace: req.body.namespace || config.defaultNamespace,
      variant: req.body.variant,
      startTime: null,
      description: req.body.description || "",
      completerID: null,
      completed: false,
      refererID: req.body.refererID || null,
      key: req.body.key,
      data: req.body.data
    });
    return task;
  });
  if(!task){
    res.status(409).send({
      ok: false,
      error: "Task already exists",
      code: "key_conflict"
    });
    return;
  }
  // broadcast existsence
  suggestTask(task);

  // hmmm

  res.send({
    ok: true,
    data: task.toJSON() // this let's  client know the task id
  });
});

router.get('/tasks/preview', async (req, res) => {
    res.send({
      ok: true,
      data: (await Tasks.findAll({
        limit: 10,
        where: {
          namespace: req.query.namespace || config.defaultNamespace
        }
      })).get()
    });
});

router.get('/tasks/preview', async (req, res) => {
  res.send((await Tasks.findAll({
    limit: 10,
    where: {
      namespace: req.query.namespace || config.defaultNamespace
    }
  })).get());
});

router.get('/tasks/preview_all', async (req, res) => {
  res.send((await Tasks.findAll({
    limit: 25,
    where: {}
  })).get());
});

// use this when you don't have anything suggested
router.get('/tasks/by_caps', async (req, res) => {
  res.send((await Tasks.findAll({
    limit: 100,
    where: {
      variant: req.query.variant,
      namespace: req.query.namespace || config.defaultNamespace
    }
  })).get());
});

router.post("/tasks/acquire", async (req, res) => {
  // filter by acceptable tasks
  const matchingTasks = await Tasks.findAll({
    limit: 100,
    where: {
      variant: req.body.variant,
      namespace: req.body.namespace || config.defaultNamespace
    }
  });
  if(matchingTasks.length === 0){
    res.status(404).send({
      ok: false,
      error: "No matching tasks found"
    });
    return;
  }

  for(let task of matchingTasks){
    const key = getTaskKey(task.namespace, task.id);
    let result = lock.acquire(key, async () => {
      // refetch to make sure it's still avali
      const task = await Tasks.findByPk(task.id);
      if(task.completerID === req.body.clientID || !task.completerID){
        task.completerID = req.body.clientID;
        task.startTime = new Date();
        task.completed = false;
        await task.save();
        // mark client as busy
        // we emit this change so other clients TRY to not acquire
        emitter.emit("global", {
          event: {
            type: "task_acquiring",
            id: task.id,
            variant: task.variant,
            clientID: task.completerID
          }
        });
        await lock.acquire(getClientKey(task.namespace, task.completerID), async () => {
          const client = await Clients.findByPk(task.completerID);
          await client.save();
        });
        emitter.emit("global", {
          event: {
            type: "task_acquired",
            id: task.id,
            variant: task.variant,
            clientID: task.completerID
          }
        });
        
        return task;
      }else{
        // taken
        return null;
      }
    });
    if(result){
      res.send({
        ok: true,
        data: result.toJSON()
      })
      return result;
    }else{
      res.send({
        ok: false,
        error: "Task is already acquired.",
        code: "acquired"
      })
    }
  }
});

router.post("/tasks/complete", async (req, res) => {
  const task = await Tasks.findByPk(req.body.id);
  if(task.completerID === req.body.clientID){
    task.completed = true;
    await task.save();
    // mark client as busy
    // we emit this change so other clients TRY to not acquire
    emitter.emit("global", {
      event: {
        type: "task_completed",
        id: task.id,
        flags: task.flags,
        clientID: task.completerID
      }
    });
    res.send({
      ok: true,
      data: task.toJSON()
    })
  }else{
    res.send({
      ok: false,
      error: "Task is not acquired by client.",
      code: "not_acquired"
    })
  }
});

// TODO: expire tasks that take too long

router.get("/clients/list", async (req, res) => {
  res.send((await Clients.findAll({
    limit: 100,
    offset: parseInt(req.query.offset || "0"),
    where: {
      namespace: req.query.namespace || config.defaultNamespace
    }
  })).get());
});


router.get("/clients/get", async (req, res) => {
  res.send((await Clients.findByPk(req.query.clientID, {
    include: [
      {
        model: Tasks,
        as: 'tasks',
        attributes: ['id', 'namespace', 'name', 'description', 'flags', 'startTime', 'completerID', 'completed'],
        where: {
          completed: false
        }
      }
    ]
  })).get());
});

router.post("/clients/sync", async (req, res) => {
  await Clients.upsert({
    id: req.body.id,
    online: true,
    lastHeartbeat: new Date(),
    caps: req.body.caps,
    namespace: req.body.namespace || config.defaultNamespace
  });
});

router.post("/artifacts/upload", async (req, res) => {
  const buffer = req.body;
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const bucket = hash.slice(0, 2);
  const ext = req.get('content-type').split('/')[1];
  const bucketPath = `${bucket}`;
  const filename = `${hash}.${ext}`;
  await fs.promises.mkdir(path.join(config.dataPath,"artifacts",bucketPath), {recursive: true});
  await fs.promises.writeFile(path.join(config.dataPath,"artifacts",bucketPath, filename), buffer);
  res.send({
    ok: true,
    data: {
      path: `${bucketPath}/${filename}`,
      filename: filename,
      bucket: bucket,
      ext: ext,
      hash: hash
    }
  });
});

router.post("/artifacts/bulkcreate", async (req, res) => {
    if(req.body && req.body.length){
        // TODO: 
        try{
          let creationObjs = req.body.map(obj => {
              return {
                  namespace: req.query.namespace || config.defaultNamespace,
                  name: obj.name,
                  description: obj.description,
                  type: obj.type,
                  task_id: obj.task_id,
                  path: obj.path
              }
          });

          // check paths
          for(let obj of creationObjs){
            if(!obj.path){
              res.status(400).send({
                  ok: false,
                  error: "No path provided"
              });
              return;
            }

            let objPath = path.normalize(path.join(config.dataPath, "artifacts", obj.path));
            if(objPath.startsWith(path.join(config.dataPath, "artifacts"))){
              if(!(await fs.promises.stat(objPath)).isFile()){
                res.status(400).send({
                    ok: false,
                    error: "Path is not a uploaded file"
                });
                return;
              }
            }else{
              throw new Error("Path is outside of artifacts directory");
            }
          }

          let creationResults = await Artifacts.bulkCreate(creationObjs, {});
          creationResults.forEach(result => {
            emitter.emit("global", {
              event: {
                type: "task_created",
                id: result.id,
                flags: result.flags,
              }
            });
          });
          res.send({
              ok: true,
              data: creationResults.map(result => result.toJSON())
          });
        }catch(ex){
          res.status(500).send({
              ok: false,
              error: ex.message
          });
        }
    }else{
        res.status(400).send({
            ok: false,
            error: "No data provided"
        });
        return;
    }
});

// https://www.digitalocean.com/community/tutorials/nodejs-server-sent-events-build-realtime-app
router.get("/events/:id", (req, res) => {
  let clientID = req.params.id;
  // check valid clientID
  // TODO: 

  // start stream
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  };
  res.writeHead(200, headers);

  function handleEvent(event){
    res.write(JSON.stringify({
      event: event.event,
      time: Date.now(),
    }) + "\n")
  }

  emitter.on("global", handleEvent);
  emitter.on(`event:${clientID}`, handleEvent);

  req.on("close", () => {
    console.log("Client disconnected");
    emitter.removeListener(`event:${clientID}`, handleEvent);
    emitter.removeListener("global", handleEvent);
  });
})

export default router;