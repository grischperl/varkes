#!/usr/bin/env node
'use strict'

import * as config from "@varkes/configuration"
import path = require("path");
const express = require('express')
const cds = require('@sap/cds')
const edm2csn = require('@sap/edm-converters/lib/edmToCsn/lib/main')
const app = express()
const fs = require('fs');
const TwoSchemas = /(\s*<\/Schema>\s*<Schema [^>]*>)\s*/m
const Namespace = /EntityType="([^.]+)/

const LOGGER: any = config.logger("odata-mock")
const DIR_NAME = "./generated";
const CDS_FILE = "data.cds"

export async function init(config: config.Config): Promise<any> {
  if (!fs.existsSync(DIR_NAME)) {
    fs.mkdirSync(DIR_NAME);
  }

  for (let i = 0; i < config.apis.length; i++) {
    let api = config.apis[i]
    if (api.type == "odata") {
      await compile(api)
    }
  }

  let csn = await cds.load(path.resolve(DIR_NAME, CDS_FILE))
  await cds.deploy(csn).to('sqlite::memory:', { primary: true })
  await cds.serve('all').from(csn).in(app)
  return app
}

async function compile(api: config.API): Promise<void> {
  LOGGER.debug("Compiling %s from %s", api.name, api.specification)

  let edmx = loadEdmx(api.specification)
  const namespace = resolveNamespaceFromEdmx(edmx, api.name)

  // FIX for unsupport of multiple namespaces in edmx
  if (TwoSchemas.test(edmx)) {
    edmx = edmx.replace(TwoSchemas, '').replace(/<Schema Namespace="[^"]+"/, `<Schema Namespace="${namespace}"`)
  }

  let csn = await edm2csn.generateCSN(edmx, false)
  var errors = edm2csn.getErrorList();
  if (!csn && errors) {
    throw new Error(edm2csn.displayErrors(errors))
  }

  csn = await fixCsn(csn, edmx, api.basepath, namespace)

  let fileName = saveCsn(csn, api.name)

  appendToCds(fileName, namespace)
  LOGGER.debug("Serving %s from %s", api.name, api.basepath)
}

function loadEdmx(filePath: string): string {
  if (!edm2csn.isValidInputFile(true, filePath)) {
    var errors = edm2csn.getErrorList();
    throw new Error(edm2csn.displayErrors(errors))
  }

  return fs.readFileSync(filePath, 'utf-8')
}

async function fixCsn(csnString: string, edmx: string, basepath: string, namespace: string): Promise<string> {
  let csn = JSON.parse(csnString)

  // FIX for edm2csn not adding service definitions
  csn.definitions[namespace] = { kind: 'service', '@imported': true, '@path': basepath }

  // FIX for edm2csn using EntityType names instead of EntitySet names
  for (let each in csn.definitions) {
    const def = csn.definitions[each]
    if (def.kind !== 'entity') continue
    if (RegExp(`<EntitySet Name="${each.replace(namespace + '.', '')}"`).test(edmx)) continue
    const [, EntitySet] = RegExp(`<EntitySet Name="(\\w+)" EntityType="${each}"`).exec(edmx) || []
    if (EntitySet) {
      const name = namespace + "." + EntitySet
      csn.definitions[name] = csn.definitions[each]
      for (let entry of Object.values(csn.definitions)) {
        let d: any = entry
        d["@cds.persistence.skip"] = false
        if (d.elements) for (let element of Object.values(d.elements)) {
          let e: any = element
          if (e.type === each) e.type = name
          if (e.target === each) e.target = name
        }
      }
      delete csn.definitions[each]
    }
  }

  return JSON.stringify(csn, null, 2)
}

function resolveNamespaceFromEdmx(edmx: string, apiName: string): string {
  const matchArray: RegExpMatchArray | null = edmx.match(Namespace)
  if (matchArray == null) {
    throw new Error(`Cannot determine namespace from ${apiName}`)
  }
  return matchArray[1]
}

function saveCsn(csn: string, apiName: string): string {
  let fileName = path.resolve(DIR_NAME, apiName.replace(/[^\w]/g, '').toLowerCase() + ".json")
  edm2csn.saveCSNModel(csn, fileName, true);
  var errors = edm2csn.getErrorList();
  if (!csn && errors) {
    throw new Error(edm2csn.displayErrors(errors))
  }
  return fileName
}

async function appendToCds(cdsPath: string, namespace: string): Promise<void> {
  let fileName = path.resolve(DIR_NAME, CDS_FILE)

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(fileName, { flags: 'a' });
    file.write(`using {${namespace}} from '${cdsPath}';\n\n`);
    file.end();
    file.on("finish", () => { resolve(); });
    file.on("error", (err: Error) => reject(err));
  });
}