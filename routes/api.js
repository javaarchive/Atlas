import {Router} from 'express';
import {sequelize} from '../models/index.js';
import {Tasks, Clients, Artifacts} from "../models/index.js";
import {Sequelize, DataTypes, Op} from 'sequelize';
import { config } from '../config.js';
import fs from "fs";
import path from "path";

import crypto from "crypto";

import AsyncLock from 'async-lock';

const taskLock = new AsyncLock();

const router = Router();

function getKey(namespace, id){
  return `${namespace}:${id}`;
}

router.get('/', (req, res) => {
    res.send('Hello from API!');
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
    const key = getKey(task.namespace, task.id);
    let result = taskLock.acquire(key, async () => {
      // refetch to make sure it's still avali
      const task = await Tasks.findByPk(task.id);
      if(task.completerID === req.body.clientID || !task.completerID){
        task.completerID = req.body.clientID;
        task.startTime = new Date();
        task.completed = false;
        await task.save();
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

export default router;