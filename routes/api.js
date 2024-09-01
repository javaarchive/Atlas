import {Router} from 'express';
import {resyncCounts, resyncKnown, sequelize} from '../models/index.js';
import {Tasks, Clients, Artifacts} from "../models/index.js";
import {Sequelize, DataTypes, Op} from 'sequelize';
import { config } from '../config.js';
import fs from "fs";
import path from "path";
import { EventEmitter } from 'events';

import crypto from "crypto";

import AsyncLock from 'async-lock';
import { cache } from '../cache.js';

import robotsParser from "robots-txt-parser";

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

async function suggestTask(task){
  const clients = await Clients.findAll({
    where: {
      namespace: task.namespace
    }
  });

  for(let client of clients){
    const clientID = client.id;

    // check compat with variant
    if(task.variant !== client.variant){
      continue;
    }

    emitter.emit(`event:${clientID}`, {
      event: {
        type: "task_suggested",
        id: task.id,
        variant: task.variant,
        key: task.key,
        data: task.data,
        task: task.toJSON()
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

    if(clientID && !clients[0]){
      clients = [];
      res.status(404).send({
        ok: false,
        error: "Client not found, are you connected?",
        code: "client_not_found"
      });
    }

    if(clientID && req.body.repeat){
      let repeatTimes = parseInt(req.body.repeat);
      if(repeatTimes < 1){
        repeatTimes = 1;
      }
      let newClients = [];
      for(let i = 0; i < repeatTimes; i++){
        newClients.push(...clients  );
      }
      clients.length = 0;
      clients.push(...newClients);
    }

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
            data: task.data,
            task: task.toJSON()
          }
        });
      }
    }

    res.json({
      ok: true,
      data: {
        status: "ok",
        clientsCount: clients.length
      }
    })
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
    await cache.inc(task.variant);
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

router.get('/tasks/get/:id', async (req, res) => {
  res.send((await Tasks.findByPk(req.params.id)).toJSON());
});

router.get('/tasks/by_client/:clientID', async (req, res) => {
  res.send((await Tasks.findAll({
    where: {
      completerID: req.params.clientID
    }
  })).get()); // does toJSON() work the same?
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

router.get('/tasks/cache_count/:variant', async (req, res) => {
  res.send({
    ok: true,
    data: (await cache.get(req.params.variant))
  });
});

router.get('/tasks/cache_count', async (req, res) => {
  res.send({
    ok: true,
    data: (await cache.toJSON())
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
router.get('/tasks/by_variant', async (req, res) => {
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
  const matchingTasks = req.query.id ? (await Tasks.findAll({
    where: {
      id: req.query.id
    },
    limit: 1
  })) : (await Tasks.findAll({
    limit: 100,
    where: {
      variant: req.body.variant,
      namespace: req.body.namespace || config.defaultNamespace
    }
  }));
  if(matchingTasks.length === 0){
    res.status(404).send({
      ok: false,
      error: "No matching tasks found"
    });
    return;
  }

  for(let task of matchingTasks){
    const key = getTaskKey(task.namespace, task.id);
    let result = await lock.acquire(key, async () => {
      // refetch to make sure it's still avali
      // variable shadowing here is fine I hope?
      task = await Tasks.findByPk(task.id);
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
            clientID: task.completerID,
            task: task.toJSON()
          }
        });
        await lock.acquire(getClientKey(task.namespace, task.completerID), async () => {
          await cache.dec(task.variant);
          const client = await Clients.findByPk(task.completerID);
          await client.save();
        });
        emitter.emit("global", {
          event: {
            type: "task_acquired",
            id: task.id,
            variant: task.variant,
            clientID: task.completerID,
            task: task.toJSON()
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
      return;
    }else{
      
    }
  }
  res.send({
    ok: false,
    error: "Tasks are already acquired. Busy server?",
    code: "acquired"
  })
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
        variant: task.variant,
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


router.post("/tasks/resync", async (req, res) => {
  await resyncCounts(req.body.variant, config.defaultNamespace || req.body.namespace);
  res.json({
    ok: true,
    message: "resynced tasks for given variant"
  });
});

router.post("/tasks/resync_known", async (req, res) => {
  await resyncKnown(config.defaultNamespace || req.body.namespace);
  res.json({
    ok: true,
    message: "resynced tasks for all known variants"
  });
});

router.post("/tasks/resync/:variant", async (req, res) => {
  await resyncCounts(req.params.variant, config.defaultNamespace || req.query.namespace);
  res.json({
    ok: true,
    message: "resynced tasks for given variant"
  });
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
  const [client, updated] = await Clients.upsert({
    id: req.body.id,
    online: true,
    lastHeartbeat: new Date(),
    variant: req.body.variant,
    namespace: req.body.namespace || config.defaultNamespace
  });
  res.json({
    ok: true,
    data: client.toJSON(),
    updated: updated
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

async function getRobots(host, namespace = config.defaultNamespace){
  let artifact = await Artifacts.findOne({
    where: {
      name: host,
      namespace: namespace,
      type: "robots"
    }
  });

  if(!artifact){
    return null;
  }

  const contents = path.join(config.dataPath, "artifacts", artifact.path);
  return (await fs.promises.readFile(contents));
}

router.get("/robots/file/:host", async (req, res) => {
  let robotsTxtBuffer = await getRobots(req.params.host, config.defaultNamespace || req.query.namespace);
  if(!robotsTxtBuffer){
    res.status(404).send({
      ok: false,
      error: "No robots.txt found for host given.",
      code: "no_robots_txt"
    });
    return;
  }
  res.send(robotsTxtBuffer.toString());
});

router.get("/robots/check/:host", async (req, res) => {
  const host = req.params.host;
  let robotsTxtBuffer = await getRobots(host, config.defaultNamespace || req.query.namespace);
  if(!robotsTxtBuffer){
    res.status(404).send({
      ok: false,
      error: "No robots.txt found for host given.",
      code: "no_robots_txt"
    });
    return;
  }

  // parse robots.txt
  const parser = robotsParser({
    allowOnNeutral: true,
    userAgent: req.query.ua || req.get("User-Agent"),
  });
  const robotsString =  robotsTxtBuffer.toString();
  parser.parseRobots("http://" + host,robotsString);
  parser.parseRobots("https://" + host,robotsString);

  const output = {
      delay: await parser.getCrawlDelay(),
      sitemaps: await parser.getSitemaps()
  };

  if(req.query.url){
    const normalURL = new URL(req.query.url, "http://" + host);
    if(normalURL.host != host){
      res.status(400).send({
        ok: false,
        error: "URL is not on host supplied as parameter.",
        code: "url_not_on_host"
      });
      return;
    }
    output["allowed"] = await parser.canCrawl(url.toString());
  }

  res.send({
    ok: true,
    data: output
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
router.get("/events/:id", async (req, res) => {
  let clientID = req.params.id;
  // check valid clientID
  // TODO: 
  let client = await Clients.findByPk(clientID);
  if(!client){
    res.status(404).send({
      ok: false,
      error: "Client not found, are you connected?",
      code: "client_not_found"
    });
    return;
  }

  // start stream
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  };
  res.writeHead(200, headers);

  client.lastHeartbeat = new Date();
  client.online = true;
  await client.save();

  function handleEvent(event){
    res.write("data: " + JSON.stringify({
      event: event.event,
      time: Date.now(),
    }) + "\n\n")
  }

  handleEvent({
    event: {
      type: "hello",
      time: Date.now()
    }
  });

  handleEvent({
    event: {
      type: "heartbeat",
      time: Date.now()
    }
  });

  emitter.on("global", handleEvent);
  emitter.on(`event:${clientID}`, handleEvent);
  if(client.variant){
    emitter.on(`variant:${client.variant}`, handleEvent);
  }

  req.on("close", () => {
    console.log("Client disconnected");
    emitter.removeListener(`event:${clientID}`, handleEvent);
    emitter.removeListener("global", handleEvent);
    if(client.variant){
      emitter.removeListener(`variant:${client.variant}`, handleEvent);
    }
  });
})

export let heartbeater = setInterval(() => {
  emitter.emit("global", {
    event: {
      type: "heartbeat",
      time: Date.now()
    }
  });
}, 1000 * 10);

cache.on("change", async (key) => {
  emitter.emit("variant:" + key, {
    event: {
      type: "sync_cache_count_sub",
      variant: key,
      value: await cache.get(key)
    }
  });
});

export default router;