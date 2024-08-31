# Distributed Web Scraping Platform
So I reinvented a task queue I guess?

## Development
Notes: the database structures used are only compatible with PostgreSQL. Thus for development, you need to use the `docker-compose.dev.yml` file (see the scripts folder to start one).

## Production
Please change the postgres password.

## Setup
Currentl development setup.
```bash
# for postgres
scripts/database.sh
```
In another terminal:
```bash
npm install # first time only
npm start
```
Eventually I'll make a dockerfile that you can just run but not yet.