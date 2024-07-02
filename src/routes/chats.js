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

router.post('/add-friend', async (req, res) => {
    const { friendName } = req.body;

    try {
        const friend = await User.findOne({ username: friendName });
        if (!friend) {
            console.log('Não foi possível encontrar o usuário pelo nome de usuário', friendName);
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const currentUser = await User.findById(req.session.userId);
        if (!currentUser) {
            console.log('Não foi possível encontrar o usuário atual', req.session.userId);
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        if (currentUser.username === friendName) {
            return res.status(400).json({ error: 'Você não pode se adicionar como amigo.' });
        }

        let friendship = await Friendship.findOne({ user: currentUser._id });
        if (!friendship) {
            friendship = new Friendship({ user: currentUser._id, friends: [] });
        }

        if (!friendship.friends.includes(friend._id)) {
            friendship.friends.push(friend._id);
            await friendship.save();
        }

        res.status(200).json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao adicionar amigo. Tente novamente mais tarde.' });
    }
});

module.exports = router;
