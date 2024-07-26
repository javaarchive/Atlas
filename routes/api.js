import {Router} from 'express';
import {sequelize} from '../models/index.js';
import {Tasks} from "../models/index.js";
import {Sequelize, DataTypes, Op} from 'sequelize';

const router = Router();

router.get('/', (req, res) => {
    res.send('Hello from API!');
});

router.get('/tasks/preview', async (req, res) => {
    res.send({
      ok: true,
      data: (await Tasks.findAll({
        limit: 10
      })).get()
    });
});

router.get('/tasks/preview', async (req, res) => {
  res.send((await Tasks.findAll({
    limit: 10
  })).get());
});

router.get('/tasks/by_caps', async (req, res) => {
  res.send((await Tasks.findAll({
    limit: 100,
    where: {
      flags: {
        [Op.contains]: req.query.caps
      }
    }
  })).get());
});

export default router;