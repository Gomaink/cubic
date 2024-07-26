const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const User = require('./models/User');

const { createServer } = require('node:https');
const { Server } = require('socket.io');
const fs = require('fs');

require('dotenv').config();

//Express instance
const app = express();
const port = process.env.PORT;

//const server = createServer(app);
// Read SSL certificate
const privateKey = fs.readFileSync('key.pem', 'utf8');
const certificate = fs.readFileSync('cert.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

const server = createServer(credentials, app);
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

const friendsRouter = require('./routes/friends');
app.use("/friends", friendsRouter);

const messagesRouter = require('./routes/messages');
app.use("/messages", messagesRouter);

const userRouter = require('./routes/user');
app.use("/user", userRouter);

// Routes
app.get("/", (req, res) => {
    res.render("index");
});

app.get("/error", (req, res) => {
    const { error, errorMessage } = req.query;
    res.render("error", { error, errorMessage });
});

let usersOnline = {};

// WebSockets logic
io.on('connection', (socket) => {
    
    const userId = socket.handshake.query.currentUserId;
    
    if (userId) {
        usersOnline[userId] = socket.id;
        
        User.findByIdAndUpdate(userId, { online: true }, { new: true })
            .then(user => {
                if (user) {
                    console.log(`User ${user.username} is now online`);
                    io.emit('userStatusChanged', { userId, online: true });
                }
            })
            .catch(err => console.error(err));
    }

    socket.on('userChanges', (userId, nickname, avatar) => {
        io.emit('userStatusChanged', { userId, online: true, nickname, avatar });
    });

    socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`User joined room: ${room}`);
    });

    socket.on('sendMessage', ({ user, userAvatar, room, message }) => {
        io.to(room).emit('receiveMessage', { user, userAvatar, message });
    });


    socket.on('disconnect', () => {
        User.findByIdAndUpdate(userId, { online: false }, { new: true })
            .then(user => {
                if (user) {
                    console.log(`User ${user.username} is now offline`);
                    for (let userId in usersOnline) {
                        console.log(usersOnline[userId]);
                        if (usersOnline[userId] === socket.id) {
                            delete usersOnline[userId];
                            io.emit('userStatusChanged', { userId, online: false });
                            break;
                        }
                    }
                }
            })
            .catch(err => console.error(err));
    });
});

//Express listener
server.listen(port, () => console.log(`Server running on port ${port}.`));