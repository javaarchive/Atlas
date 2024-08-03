// this crawler is highly controlled by env variables

import { Client } from "../client.js";

// we start by extending the base class and implementing this ufnc
class PuppeteerHeadless extends Client {
    constructor(url, clientID, namespace = "default", variant = "default", concurrency = 1){
        super(url, clientID, namespace, variant, concurrency);
    }
}

// todo if __name__ == "__main__" but for js
const client = new PuppeteerHeadless("http://localhost:3000", "test", "default", "pptr-headless", 4);
client.connect();