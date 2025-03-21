﻿<div class="row w-100">
<div class="col-3 d-none d-lg-inline">
<div class="sticky-top overflow-auto vh-100">
<div id="list-headers" class="list-group mt-5">

- [Tiny HTTPS Server](#tiny-https-server)
     - [Description](#description)
     - [Features](#features)
     - [Installation](#installation)
     - [Testing](#testing)
     - [How to use](#how-to-use)
     - [License](#license)
 
 
</div>
</div>
</div>
 
<div class="col">
<div class="p-2 markdown-body" data-bs-spy="scroll" data-bs-target="#list-headers" data-bs-offset="0" tabindex="0">


# Tiny HTTPS Server
This manual is also available in [HTML5](https://manuel-lohmus.github.io/tiny-https-server/README.html).<br>
Tiny web server with HTTPS support, static file serving, 
subdomain support, middleware support, service worker support, and clastering support.

## Description
Tiny web server is disain for SPA (Single Page Application). 
This project is a tiny web server that serves static files, supports HTTPS, 
subdomains, middleware, and service workers. 
When you run the server, it will serve the files in the `public` directory. 
You can add your own files to the `public` directory and access them through the server. 
The server also supports subdomains, so you can access different files based on the subdomain. 
For example, if you have a file called `index.html` in the `public` directory, 
you can access it through `https://localhost/index.html`. 
If you have a file called `index.html` in the `public/subdomain` directory, 
you can access it through `https://subdomain.localhost/index.html`. 
The server also supports middleware, so you can add your own middleware functions to the server. 
The server also supports service workers. 
For testing uses a self-signed certificate, so you may see a warning in your browser when you access the server.
You can ignore the warning and proceed to the server.
Yor can mount the express.js style middleware to the server. Example:
```javascript
const WebCluster = require('tiny-https-server');
const express = require('express');
const admin = express();
admin.get('/', (req, res) => {
  res.send('Admin Homepage');
});
consr cluster = WebCluster({
    //isDebug: true,
    parallelism: 'auto 2'
}, function _initServer(server) {
    server.addRequest({ path: '/admin' }, admin);
});
```


## Features

- HTTPS support
- HTTP to HTTPS redirection 
- static file serving
- subdomain support 
- service worker support 
- blacklist support
- middleware support 
- mounting support express.js style
- clastering support automatic scaling up and down
- compression support
- cache control support
- path validation support
- traffic-advice support
- security.txt support
- acme-challenge support for letsencrypt
- test self-signed certificate support
- configurable in JSON format file `config-sets.json`
- command line support example: `tiny-https-server --help` or `tiny-https-server --parallelism='auto 1'` 

## Installation

You can install `tiny-https-server` using this command:

`npm install tiny-https-server`
 
 ## Testing

You can test `tiny-https-server` on your system using this command:

`node ./node_modules/tiny-https-server/index.test`

or in the `tiny-https-server` project directory:

`npm test`

## How to use

You can use `tiny-https-server` in your project like this:

```javascript
const WebCluster = require('tiny-https-server');

consr cluster = WebCluster({
    isDebug: true, // Enable debug mode to see logs in the console
    parallelism: 'auto 2' // Start 2 workers and scale up and down automatically
}, function _initServer(server) {
    // Add a request handler for the /hello path
    server.on('request', (req, res, next) => {
    
        if (req.url === '/hello') {

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello World');
            return;
        }
    
        next();
    });
});
```

## License

This project is licensed under the MIT License.

Copyright &copy; 2021 Manuel Lõhmus

[![Donate](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=H2ZHLF8U2HGVA)

Donations are welcome and will go towards further development of this project.

<br>
<br>
<br>
</div>
</div>
</div>