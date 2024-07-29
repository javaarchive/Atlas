import {Router} from 'express';
import {sequelize} from '../models/index.js';
import {Tasks, Clients, Artifacts} from "../models/index.js";
import {Sequelize, DataTypes, Op} from 'sequelize';
import { config } from '../config.js';

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
    if(req.body && req.body.length){
        // TODO: 
    }else{
        res.status(400).send({
            ok: false,
            error: "No data provided"
        });
        return;
    }
});

export default router;