const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// Route to send a message
router.post('/send-message', async (req, res) => {
    try {
        const { senderId, receiverId, message } = req.body;

        const newMessage = new Message({
            sender: senderId,
            receiver: receiverId,
            message
        });

        await newMessage.save();
        res.status(200).json({ success: true, message: newMessage });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao enviar a mensagem. Tente novamente mais tarde.' });
    }
});

// Route to get messages between two users
router.get('/:userId/:friendId', async (req, res) => {
    try {
        const { userId, friendId } = req.params;

        const messages = await Message.find({
            $or: [
                { sender: userId, receiver: friendId },
                { sender: friendId, receiver: userId }
            ]
        }).sort('timestamp');

        res.status(200).json({ messages });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao obter as mensagens. Tente novamente mais tarde.' });
    }
});

module.exports = router;