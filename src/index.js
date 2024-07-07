const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const { createServer } = require('node:http');
const { Server } = require('socket.io');

require('dotenv').config();

//Express instance
const app = express();
const port = process.env.PORT;

const server = createServer(app);
const io = new Server(server);

//Mongoose instance
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('Could not connect to MongoDB:', err));

//Body-parser instance
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

//Express-session instance
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
}));

//Static-files instance & EJS 
app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');

// Routers
const authenticationRouter = require('./routes/auth');
app.use("/auth", authenticationRouter);

const chatsRouter = require('./routes/chats');
app.use("/chats", chatsRouter);

// Routes
app.get("/", (req, res) => {
    res.render("index");
});

// WebSockets logic
io.on('connection', (socket) => {
    console.log('New client connected');
    
    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  
    socket.on('sendMessage', (message) => {
      io.emit('receiveMessage', message);
    });
  });

//Express listener
//app.listen(port, () => console.log(`Server running on port ${port}.`));
server.listen(port, () => console.log(`Server running on port ${port}.`));