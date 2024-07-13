const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');

//Get the list of friends
router.get('/', async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const friendship = await Friendship.findOne({ user: currentUser._id }).populate('friends', 'username');
        if (!friendship) {
            return res.status(200).json({ friends: [] });
        }

        // Busca detalhes completos de cada amigo, incluindo avatarUrl, usando o modelo User
        const friends = await User.find({ _id: { $in: friendship.friends } }).select('_id username avatarUrl nickname');

        // Preenche avatarUrl com a imagem padrão se for undefined
        friends.forEach(friend => {
            friend.avatarUrl = friend.avatarUrl || '/images/cubic-w-nobg.png';
        });

        res.status(200).json({ friends });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao obter a lista de amigos. Tente novamente mais tarde.' });
    }
});

//Add a new friend
router.post('/add-friend', async (req, res) => {
    const { friendName } = req.body;

    try {
        const friend = await User.findOne({ username: friendName });
        if (!friend) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const currentUser = await User.findById(req.session.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const existingFriendship = await Friendship.findOne({ user: currentUser._id, friends: friend._id });
        if (existingFriendship) {
            return res.status(400).json({ error: `Você e ${friendName} já são amigos.` });
        }

        if (currentUser.username === friendName) {
            return res.status(400).json({ error: 'Você não pode se adicionar como amigo.' });
        }

        const reverseRequest = await FriendRequest.findOne({ requester: friend._id, recipient: currentUser._id, status: 'pending' });
        if (reverseRequest) {
            reverseRequest.status = 'accepted';
            await reverseRequest.save();

            let friendship = await Friendship.findOne({ user: currentUser._id });
            if (!friendship) {
                friendship = new Friendship({ user: currentUser._id, friends: [] });
            }
            if (!friendship.friends.includes(friend._id)) {
                friendship.friends.push(friend._id);
            }
            await friendship.save();

            let reverseFriendship = await Friendship.findOne({ user: friend._id });
            if (!reverseFriendship) {
                reverseFriendship = new Friendship({ user: friend._id, friends: [] });
            }
            if (!reverseFriendship.friends.includes(currentUser._id)) {
                reverseFriendship.friends.push(currentUser._id);
            }
            await reverseFriendship.save();

            return res.status(200).json({ success: true });
        }

        const existingRequest = await FriendRequest.findOne({ requester: currentUser._id, recipient: friend._id, status: 'pending' });
        if (existingRequest) {
            return res.status(400).json({ error: 'Pedido de amizade já enviado.' });
        }

        const friendRequest = new FriendRequest({ requester: currentUser._id, recipient: friend._id });
        await friendRequest.save();

        res.status(200).json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao adicionar amigo. Tente novamente mais tarde.' });
    }
});

//Remove a friend
router.delete('/remove/:friendId', async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const friendId = req.params.friendId;
        await Friendship.updateOne(
            { user: currentUser._id },
            { $pull: { friends: friendId } }
        );

        res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao remover amigo. Tente novamente mais tarde.' });
    }
});

//Show the friend solicitations
router.get('/friend-list', async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const friendRequests = await FriendRequest.find({ recipient: currentUser._id, status: 'pending' })
            .populate('requester', 'username');

        res.status(200).json({ friendRequests: friendRequests });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar pedidos de amizade. Tente novamente mais tarde.' });
    }
});

//Check if exists a friend solicitation
router.get('/friend-check-notification', async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const pendingRequests = await FriendRequest.countDocuments({ recipient: currentUser._id, status: 'pending' });
        res.status(200).json({ pendingRequests });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao verificar solicitações de amizade. Tente novamente mais tarde.' });
    }
});

//Accept ou reject a friend solicitation
router.post('/respond-friend-request', async (req, res) => {
    const { requestId, action } = req.body;

    try {
        const friendRequest = await FriendRequest.findById(requestId);
        if (!friendRequest) {
            return res.status(404).json({ error: 'Pedido de amizade não encontrado.' });
        }

        if (friendRequest.recipient.toString() !== req.session.userId) {
            return res.status(403).json({ error: 'Ação não autorizada.' });
        }

        if (action === 'accept') {
            friendRequest.status = 'accepted';

            let requesterFriendship = await Friendship.findOne({ user: friendRequest.requester });
            if (!requesterFriendship) {
                requesterFriendship = new Friendship({ user: friendRequest.requester, friends: [] });
            }
            requesterFriendship.friends.push(friendRequest.recipient);

            let recipientFriendship = await Friendship.findOne({ user: friendRequest.recipient });
            if (!recipientFriendship) {
                recipientFriendship = new Friendship({ user: friendRequest.recipient, friends: [] });
            }
            recipientFriendship.friends.push(friendRequest.requester);

            await requesterFriendship.save();
            await recipientFriendship.save();
        } else {
            friendRequest.status = 'declined';
        }

        await friendRequest.save();
        res.status(200).json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao responder ao pedido de amizade. Tente novamente mais tarde.' });
    }
});

module.exports = router;