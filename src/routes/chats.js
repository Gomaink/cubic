const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Friendship = require('../models/Friendship');

router.get('/', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect("/auth/login");
        }

        const currentUser = await User.findById(req.session.userId);
        
        const friendship = await Friendship.findOne({ user: currentUser._id }).populate('friends');

        const friendsList = friendship ? friendship.friends : [];

        const allUsers = await User.find().select('_id username nickname');

        return res.render('chats', { currentUser, friendsList, allUsers });

    } catch (err) {
        console.error(err);
        res.status(500).send('Erro interno do servidor');
    }
});

module.exports = router;
