# Cubic - Online Chat Platform
Cubic is an online chat platform where you can add friends, chat with them in real-time, make video calls, and customize your profile — all for free. Our environment is perfect for gamers, ensuring that you don't lose performance while using all our online features. If you are looking for a place to have fun, connect, and interact, Cubic is the ideal choice. Join us and start exploring all the possibilities we offer!

# Features
- **User Authentication**: Secure registration and login system with username, email, and password. Users can update their profile details, including username, nickname, email, password, and avatar.
- **Real-Time Chat**: Supports real-time messaging using Socket.io, where messages load from the most recent at the bottom. The chat area displays avatars and usernames side by side.
- **Friendship Management**: Allows users to send, accept, or decline friend requests dynamically via AJAX. Friends are added to a sidebar that accommodates a large number of friends without overlapping other elements.
- **Voice Chat Feature**: Users can join voice chat rooms based on specific chat rooms. Each room can have up to 2 users, and direct calls are initiated without requiring the peer ID.
- **User Online Status**: Displays online or offline status based on the user's socket connection. The user schema includes an Online field that is updated when the user connects or disconnects.
- **Account Management**: Users can manage their account details such as username, nickname, email, avatar, and password. A modal interface is provided for updating these details asynchronously.
- **User Avatar Upload**: Users can upload and update their avatar images securely. The backend stores the path to the user's photo and ensures that old avatars are deleted to save storage.
- **Audio Settings**: Users can save and load audio configurations (input and output volume settings) to customize their experience.
- **Data Encryption**: Unique encryption keys are generated and saved in environment variables to secure sensitive data like passwords.
- **Peer-to-Peer Communication**: Integrates PeerJS for peer-to-peer communication and supports audio calls with microphone mute/unmute functionality.

# Technologies Used
- **Frontend**: HTML, CSS (Bootstrap 5.3), JavaScript (ES6+), EJS (Embedded JavaScript) for templating.
- **Backend**: Node.js, Express.js for server-side logic and routing.
- **Database**: MongoDB with Mongoose for data modeling and management.
- **Real-Time Communication**: Socket.io for real-time messaging and notifications.
- **Peer-to-Peer Communication**: PeerJS for voice chat and direct calls between users.
- **Security**: bcryptjs for password hashing, environment variables for sensitive data.
- **File Management**: multer for handling file uploads (avatars).
- **AJAX and jQuery**: For dynamic content updates without refreshing the page.
- **Session Management**: Express-session for handling user sessions and maintaining authentication state.
- **Error Handling and Logging**: Custom error handling middleware for improved debugging and logging.

# Installation
To get started with Cubic, follow the steps below:

## 1. Clone the Repository:
```
git clone https://github.com/yourusername/cubic.git
cd cubic
```

## 2. Install Dependencies:
```
npm install
```

## 3. Configure Environment Variables:
Create a .env file in the root directory and add the following:
```
SECRET_KEY= Your crypto secret key (cryptoUtils.js)
PORT=3000
MONGO_URI= Your mongodb uri
SESSION_SECRET= Your session secret
GMAIL_APPKEY= Your gmail application key
```

## 4. Run the Application:
```
npm run devstart
```

**!!! For your test environment you need to generate an SSL certificate, and add the files to the root folder (the files are configured for: cert.pem, csr.pem and key.pem) !!!**

The application will run on `https://localhost:3000.`

# API Documentation
Below is the list of available API endpoints for the Cubic platform.

## Authentication Endpoints
```
GET /check-auth
GET /login
POST /login
GET /register
POST /register
GET /logout
POST /forgot-password
GET /forgot-password/:token
POST /reset-password/:token
```

## User Endpoints
```
POST /update-username
POST /update-nickname
POST /upload-avatar
POST /update-email
POST /update-password
POST /verify-password
POST /update-peerid
POST /delete-account
POST /configs/save
GET /configs/:userId
```

## Chat Endpoints
```
GET /chats
```

## Friends Endpoints
```
GET /load-friends
GET /friend-data/:friendId
POST /add-friend
DELETE /remove/:friendId
GET /friend-list
GET /friend-check-notification
POST /respond-friend-request
GET /load-requests
DELETE /remove-request/:requestId
```

## Messages Endpoints
```
POST /send-message
GET /:userId/:friendId
```

# Contributing
If you would like to contribute to Cubic, please follow these guidelines:

Fork the repository.
Create a new branch (git checkout -b feature/YourFeature).
Commit your changes (git commit -m 'Add your feature').
Push to the branch (git push origin feature/YourFeature).
Create a pull request.
