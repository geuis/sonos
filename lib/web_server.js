var rest = require('restify'),
    socketio = require('socket.io'),
    fs = require('fs');

var STATIC_PATH = process.env.PWD + '/static/';

// Routes
var routes = {
  '/': {
    method: 'get',
    fn: function (req, res, next) {
      fs.readFile(STATIC_PATH + 'templates/index.html', function (err, data) {
        res.header('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(data);
      });
      return next();
    }
  },
  '/static/:path/:file': {
    method: 'get',
    fn: function (req, res, next) {

      fs.readFile(STATIC_PATH + req.params.path + '/' + req.params.file, function (err, data) {

        if (err) {
          res.writeHead(404);
          res.end(err);
        } else {

          var type = req.params.file.split('.'),
              type = type[type.length-1];
              
          type === 'css' ?
            res.header('Content-Type', 'text/css'):
          type === 'js' ?
            res.header('Content-Type', 'application/javascript'):
          type === 'png' ?
            res.header('Content-Type', 'image/png'):
          type === 'jpg' ?
            res.header('Content-Type', 'image/jpeg'):
            res.header('Content-Type', 'text/plain');

          res.writeHead(200);
          res.end(data);
        }

      });

      return next();
    }

  }
};

var server = rest.createServer();

// map routes to server
for (var i in routes) {
  server[routes[i].method](i, routes[i].fn);
}

// start websocket listening
var io = socketio.listen(server);

server.listen(5000);
console.log('Web server running');

// Socket.io configs
io.sockets.on('connection', function (socket) {
  socket.emit('news', {hello: 'world'});
  socket.on('my other event', function (data) {
    console.log(data);
  });
});

module.exports = {};
