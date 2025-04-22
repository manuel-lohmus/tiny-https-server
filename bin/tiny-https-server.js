#!/usr/bin/env node

'use strict';

var WebCluster = require('../index.js'),
    configSets = require("config-sets"),
    { isPrimary } = require('node:cluster'),
    { help, debug, parallelism, host, port, logdir, docroot, privkey, cert, links } = configSets.arg_options();

configSets.isSaveChanges = false;

//pDebug('arg_options:', { help, debug, parallelism, host, port, logdir, docroot, privkey, cert, links });

var options = {

    isDebug: Boolean(debug) || false,
    parallelism: parallelism || 'auto',
    host: host || "0.0.0.0",
    port: parseInt(port) || process.env.PORT || 80,
    logDir: typeof logdir === 'string' ? logdir : './log/tiny-https-server',
    primary_domain: {
        document_root: docroot || './',
        precache_urls: null
    },
    pathToPrivkey: privkey || undefined,
    pathToCert: cert || undefined
}

if (isPrimary) { pDebug('options:', options); }

if (help) {

    console.log(`
tiny-https-server [OPTION1=VALUE1] [OPTION2=VALUE2] ... 
The following options are supported:
    --help              Display this help
    --parallelism       <number|string> 1 | auto | auto 1 - Default 'auto'
    --host              <string> Host name - Default '0.0.0.0'
    --port              <number> - Default env.PORT or 80
    --logdir            <string> Directory of log files - Default './log/tiny-https-server'
    --docroot           <string> Document root directory - Default './'
    --privkey           <string> Path to Private keys in PEM format
    --cert              <string> Path to Cert chains in PEM format
    --links             [<url>]  Prints the links available on the web server
    --debug
    `);

    return process.exit(0);
}

var cluster = WebCluster(options, function _initServer(server) { });

if (isPrimary && links) {

    console.log('Available links:');

    cluster.availableLinks(host).forEach(link => {

        console.log(`  ${link}`);
    });
}

// Debugging
function pDebug(msg) { if (debug) { console.log(`[ DEBUG ] 'web-cluster' `, ...arguments); } }
function pError(msg) { if (debug) { console.error(`[ ERROR ] 'web-cluster' `, ...arguments); } }