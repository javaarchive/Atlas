import express from 'express';
import {Server} from "socket.io";
import http from "http";

import {config as configureDotenv} from "dotenv";

configureDotenv();

import {init} from "./models/index.js";
import apiRouter from './routes/api.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let initing = true;

async function initEverything(){
  await init(process.env.ALTER_DB === '1');
  console.log('Database initialized.');
}

app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(express.raw({
  limit: "100mb",
  inflate: true,
}));

app.get('/', (req, res) => {
  res.send('Hello.');
});

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // TODO; use cors module
    if(initing){
      res.status(503).json({message: 'Server is initializing.', error: true});
    }
    next();
});

app.use('/api', apiRouter);

initEverything().then(() => {
    initing = false;
});

app.listen(3000, () => {
    console.log('Example app listening on port 3000!');
});