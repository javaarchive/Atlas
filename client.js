import {fetch} from "node-fetch";

import {config} from "./config.js";

import EventSource from "eventsource"

import http from "http";
import https from "https";

// https://github.com/node-fetch/node-fetch?tab=readme-ov-file#custom-agent
// http/https agent setup
const agents = {
    http: new http.Agent({
        keepAlive: true
    }),
    https: new https.Agent({
        keepAlive: true
    })
}

const defaultFetchOptions = {
    agent: (_parsedURL) => {
        if (_parsedURL.protocol == 'http:') {
			return agents.http;
		} else {
			return agents.https;
		}
    },
    headers: {
        "User-Agent": "AtlasNodeClient/1.0"
    }
}

export class Client {

    /**
     * @type {string}
     *
     * @memberof Client
     */
    baseURL;

    constructor(url, clientID, namespace = "default"){
        this.baseURL = url;
        this.namespace = namespace;
        this.clientID = clientID;
        this.onMessageBound = this.onMessage.bind(this);
    }

    connect(){
        this.source = new EventSource(`${this.baseURL}/api/events/${this.clientID}`);
        this.source.addEventListener("message", this.onMessageBound);
    }

    disconnect(){
        this.source.removeEventListener("message", this.onMessageBound);
        this.source.close();
    }

    /**
     *
     * @param {MessageEvent} event
     * @memberof Client
     */
    onMessage(event){
        // hopefully a string
        const message = JSON.parse(event.data);
        
    }

    completeTaskWrapper(task){
        
    }
    

    completeTask(task){
        // not implemented
    }

    idle(){

    }
}
