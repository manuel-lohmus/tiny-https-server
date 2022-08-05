# tiny-https-server: Easy tiny https web server middleware.

[![npm-version](https://badgen.net/npm/v/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)
[![npm-total-downloads](https://badgen.net/npm/dt/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)
[![npm-week-downloads](https://badgen.net/npm/dw/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)

Easy tiny https web server middleware.
Easy to use and configure.
Handle subdomains.
Serving static files.

## Installing

`npm install tiny-https-server`

## Usage example

app.js
```js
require('log-report');

if (require("try-to-run")()) {
    // isMainThread
    return;
}

console.time("Time");
var options = require("config-sets").tiny_https_server;
options.subdomains = { test: "./public/test" };

var server = require("tiny-https-server");
//var server = require("./server.min.js");

// Console log
server.on("request", function (req, res, next) {
    console.timeLog("Time", `Url: ${req.headers.host}${req.url}`);
    next();
});
// Test page.
server.on("request", function (req, res, next) {
    if (req.url === "/test") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("Test page.");
        res.end();
    }
    else
        next();
});
// Simulated crash ...
server.on("request", function (req, res, next) {
    if (req.url === "/crash") {
        throw new Error("Simulated crash ...");
    }
    else
        next();
});


var port = options.port === 443 ? "" : ":" + options.port;
var urls = [
    `http://localhost${port}/`,
    `http://test.localhost${port}/`,
    `http://localhost${port}/test`,
    `http://test.localhost${port}/test`,
    `http://localhost${port}/home`
];

// Opens the URLs in the default browser.
while (urls.length) {
    require("browse-url")(urls.shift());
}
```

## Config-sets file

config-sets.json
```json
{
  "production": {
    "tiny_https_server": {
      "domain": "localhost",
      "port": 443,
      "logDir": "./log/tiny-https-server",
      "document_root": "./public/www",
      "directory_index": "index.html",
      "pathToError_404": "./error_404.html",
      "pathToPrivkey": "./cert/localhost-key.pem",
      "pathToCert": "./cert/localhost-cert.pem",
      "subdomains": {
        "test": {
          "document_root": "./public/test"
        }
      },
      "cacheControl": {
        "fileTypes": {
          "bmp": "max-age=2592000",
          "jpeg": "max-age=2592000",
          "jpg": "max-age=2592000",
          "png": "max-age=2592000",
          "svg": "max-age=2592000",
          "pdf": "max-age=2592000",
          "html": "max-age=86400",
          "css": "max-age=86400",
          "js": "max-age=86400",
          "webp": "max-age=2592000"
        }
      },
      "setHeaders": {
        "default": {},
        "/": {
          "X-Frame-Options": "DENY"
        }
      }
    },
    "log_report": {
      "logDir": "./log/log-report",
      "enabled": true,
      "clear_on_startup": false,
      "save_only_uncaughtException": true
    },
    "browse_url": {
      "launch_url": "",
      "enabled": false
    },
    "try_to_run": {
      "retrying": 10,
      "enabled": true
    }
  },
  "development": {
    "tiny_https_server": {
      "subdomains": {
        "test": "./public/test"
      }
    },
    "log_report": {
      "logDir": "./log/log-report",
      "enabled": true,
      "clear_on_startup": true,
      "save_only_uncaughtException": false
    },
    "browse_url": {
      "launch_url": "https://localhost/",
      "enabled": true
    }
  }
}
```

## License

[MIT](LICENSE)

Copyright (c) 2021 Manuel L&otilde;hmus <manuel@hauss.ee>
