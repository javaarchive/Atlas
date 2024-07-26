import {Router} from 'express';
import {sequelize} from '../models/index.js';
import {Tasks} from "../models/index.js";
import {Sequelize, DataTypes, Op} from 'sequelize';
import { config } from '../config.js';

const router = Router();

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

export default router;