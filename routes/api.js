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

function getClientKey(namespace, id){
  return `client:${namespace}:${id}`;
}

function suggestTask(clientID, task){
  emitter.emit(`event:${clientID}`, {
    event: {
      type: "task_suggested",
      id: task.id,
      flags: task.flags
    }
  });
}

router.get('/', (req, res) => {
    res.send('Hello from API!');
});

router.post("/tasks/create", async (req, res) => {
  const task = await Tasks.create({
    namespace: req.body.namespace || config.defaultNamespace,
    flags: req.body.flags,
    startTime: null,
    description: req.body.description || "",
    completerID: null,
    completed: false
  });
  // broadcast existsence

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

router.get('/tasks/by_caps', async (req, res) => {
  res.send((await Tasks.findAll({
    limit: 100,
    where: {
      flags: {
        [Op.contains]: req.query.caps
      },
      namespace: req.query.namespace || config.defaultNamespace
    }
  })).get());
});

router.post("/tasks/acquire", async (req, res) => {
  // filter by acceptable tasks
  const matchingTasks = await Tasks.findAll({
    limit: 100,
    where: {
      flags: {
        [Op.contains]: req.body.caps
      },
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
        await lock.acquire(getClientKey(task.namespace, task.completerID), async () => {
          const client = await Clients.findByPk(task.completerID);
          client.lastTaskID = task.id;
          await client.save();
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
    }
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
    caos: req.body.caos,
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