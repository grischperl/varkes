#!/usr/bin/env node
'use strict'

import { logger as LOGGER } from "../logger"
import * as express from "express"
const openapiSampler = require('openapi-sampler')
import * as refParser from 'json-schema-ref-parser'
import { api, connection } from "@varkes/app-connector"

function getAll(req: any, res: any) {
    LOGGER.debug("Getting all APIs")
    let err = assureConnected()
    if (err) {
        res.status(400).send({ error: err })
    } else {
        api.findAll().then((result: any) => {
            res.status(200).send(result);
        }, (err: any) => {
            res.status(err.statusCode, err.message)
        })
    }
}

function get(req: any, res: any) {
    LOGGER.debug("Get API %s", req.params.api)
    let err = assureConnected()
    if (err) {
        res.status(400).send({ error: err })
    } else {
        api.findOne(req.params.api).then((result: any) => {

            let body = result;
            body.id = req.params.api //comply with the api spec
            if (body.events && body.events.spec && Object.keys(body.events.spec).length !== 0) { //an empty events.spec {} causes bug
                dereferenceApi(body).then((result) => {
                    res.status(200).type("json").send(result)
                }, (err) => {
                    res.status(500).send({ error: err.message })
                })
            }
            else {
                res.status(200).type("json").send(body)
            }
        }, (err: any) => {
            res.status(err.statusCode).send(err.body);
        })
    }
}

function update(req: any, res: any) {
    LOGGER.debug("Update API %s", req.params.api)
    let err = assureConnected()
    if (err) {
        res.status(400).send({ error: err })
    } else {
        api.update(req.body, req.params.api).then((result: any) => {
            res.status(200).send(result);
        }, (err: any) => {
            res.status(err.statusCode).send(err.message);
        })
    }
}

function deleteApi(req: any, res: any) {
    LOGGER.debug("Delete API %s", req.params.api)
    let err = assureConnected()
    if (err) {
        res.status(400).send({ error: err })
    } else {
        api.delete(req.params.api).then((result: any) => {
            res.status(200).send(result);
        }, (err: any) => {
            res.status(err.statusCode).send(err.message);
        });
    }
}
function create(req: any, res: any) {
    LOGGER.debug("Creating API %s", req.body.name)
    let err = assureConnected()
    if (err) {
        res.status(400).send({ error: err })
    } else {
        api.create(req.body).then((result: any) => {
            res.status(200).send(result);
        }, (err: any) => {
            res.status(err.statusCode).send(err.message);
        });
    }
}
function assureConnected() {
    if (!connection.established()) {
        return "Not connected to a kyma cluster, please re-connect"
    }
    return null
}
function dereferenceApi(body: any) {
    return new Promise((resolve, reject) => {
        refParser.dereference(body.events.spec)
            .then((schema: any) => {
                Object.keys(schema.topics).forEach((topicKey) => {
                    if (schema.topics[topicKey].publish) {
                        schema.topics[topicKey].example = openapiSampler.sample(schema.topics[topicKey].publish.payload)
                    }
                    else {
                        schema.topics[topicKey].example = openapiSampler.sample(schema.topics[topicKey].subscribe.payload)
                    }
                })
                body.events.spec = schema
                //res.status(200).type("json").send(body)
                resolve(body);
            })
            .catch(function (err) {
                reject(err);
            })
    })

}
function router() {
    let apiRouter = express.Router()

    apiRouter.get("/", getAll)
    apiRouter.post("/", create)
    apiRouter.get("/:api", get)
    apiRouter.put("/:api", update)
    apiRouter.delete("/:api", deleteApi)

    return apiRouter
}
export { router }