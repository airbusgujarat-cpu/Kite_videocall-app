const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const USERS = {
  alice: { password: '123' },
  bob: { password: '456' }
};

let activeSockets = {}; // socket.id -> username

function broadcastOnlineUsers() {
  const onlineUsers = [...new Set(Object.values(activeSockets))];
  io.emit('online-users', onlineUsers);
}

io.on('connection', (socket) => {
  // Immediately inform the freshly connected client of who is currently online
  socket.emit('online-users', [...new Set(Object.values(activeSockets))]);

  socket.on('login', ({ username, password }, callback) => {
    if (USERS[username] && USERS[username].password === password) {
      activeSockets[socket.id] = username;
      callback({ success: true, username });
      broadcastOnlineUsers();
    } else {
      callback({ success: false, message: 'Invalid credentials' });
    }
  });

  socket.on('call-user', ({ to, offer }) => {
    const callerName = activeSockets[socket.id];
    for (const [sId, name] of Object.entries(activeSockets)) {
      if (name === to) {
        io.to(sId).emit('incoming-call', { from: callerName, offer });
      }
    }
  });

  socket.on('make-answer', ({ to, answer }) => {
    for (const [sId, name] of Object.entries(activeSockets)) {
      if (name === to) {
        io.to(sId).emit('call-answered', { answer });
      }
    }
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    for (const [sId, name] of Object.entries(activeSockets)) {
      if (name === to) {
        io.to(sId).emit('ice-candidate', { candidate });
      }
    }
  });

  socket.on('end-call', ({ to }) => {
    for (const [sId, name] of Object.entries(activeSockets)) {
      if (name === to) {
        io.to(sId).emit('call-ended');
      }
    }
  });

  socket.on('disconnect', () => {
    delete activeSockets[socket.id];
    broadcastOnlineUsers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));