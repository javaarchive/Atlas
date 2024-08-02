import {Sequelize, DataTypes} from 'sequelize';
import crypto from "crypto";
import normalizeUrl from 'normalize-url';
import config from '../config.js';
import { start } from 'repl';

const sequelize = new Sequelize(config.databaseURL);


export const Tasks = sequelize.define('tasks', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    url: DataTypes.STRING,
    description: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    variant: DataTypes.STRING,
    namespace: DataTypes.STRING,
    completerID: DataTypes.STRING,
    startTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    refererID: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});

export const Artifacts = sequelize.define('artifacts', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    type: {
        type: DataTypes.STRING, // likely Content-Type or something less specific
        defaultValue: "application/octet-stream"
    },
    path: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    namespace: DataTypes.STRING,
    task_id: DataTypes.INTEGER,
    name: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

export const Clients = sequelize.define('clients', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    lastHeartbeat: DataTypes.DATE,
    online: DataTypes.BOOLEAN,
    variant: DataTypes.STRING,
    lastTaskID: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    namespace : DataTypes.STRING
});

export function generateID(url){
    return Buffer.from(normalizeUrl(url, {
        stripWWW: true,
        defaultProtocol: "http",
        removeTrailingSlash: true,
        stripAuthentication: true,
        stripHash: true,
        stripTextFragment: true
    })).toString("base64")
}

async function init(hard = false){
    await sequelize.sync({
        alter: hard
    });
}

export {sequelize, init};