import {Sequelize, DataTypes} from 'sequelize';
import crypto from "crypto";
import normalizeUrl from 'normalize-url';

const sequelize = new Sequelize(process.env.DATABASE_URL || 'sqlite://db.sqlite');


export const Tasks = sequelize.define('tasks', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    url: DataTypes.STRING,
    description: DataTypes.STRING,
    completed: DataTypes.BOOLEAN,
    flags: DataTypes.ARRAY(DataTypes.STRING),
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