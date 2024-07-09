const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');
const Message = require('../models/Message');

// Configuração do Multer para fazer upload de avatares
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/avatars');
    },
    filename: function (req, file, cb) {
        // Renomear o arquivo para evitar colisões de nomes
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 8 * 1024 * 1024 // Limite de 8MB
    },
    fileFilter: function (req, file, cb) {
        // Aceitar apenas arquivos de imagem
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo inválido. Apenas imagens são permitidas.'));
        }
    }
});

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

router.get('/list', async (req, res) => {
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

router.get('/check', async (req, res) => {
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

router.get('/friends', async (req, res) => {
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
        const friends = await User.find({ _id: { $in: friendship.friends } }).select('_id username avatarUrl');

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


router.post('/update-username', async (req, res) => {
    const { userId, newUsername } = req.body;

    try {
        const user = await User.findByIdAndUpdate(userId, { username: newUsername }, { new: true });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
            return res.render('register', { error: 'Este nome de usuário já está em uso.' });
        }

        res.status(200).json({ success: true, message: 'Nome de usuário atualizado com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao atualizar nome de usuário. Tente novamente.' });
    }
});

// Rota para atualizar o nome de exibição (nickname)
router.post('/update-nickname', async (req, res) => {
    const { userId, newNickname } = req.body;

    try {
        const user = await User.findByIdAndUpdate(userId, { nickname: newNickname }, { new: true });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        res.status(200).json({ success: true, message: 'Nome de exibição atualizado com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao atualizar nome de exibição. Tente novamente.' });
    }
});

router.post('/upload-avatar', upload.single('avatar'), async (req, res, next) => {
    try {
        const currentUser = await User.findById(req.session.userId);

        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const avatarPath = req.file.path.replace('public\\', '');

        // Excluir o avatar anterior se existir
        if (currentUser.avatarUrl) {
            const oldAvatarPath = path.join(__dirname, '..', currentUser.avatarUrl);
            fs.unlinkSync(oldAvatarPath); // Exclui o arquivo do sistema de arquivos
        }

        // Atualize o campo do caminho do avatar no documento do usuário
        currentUser.avatarUrl = avatarPath;
        await currentUser.save();

        res.json({ success: true, avatarUrl: avatarPath });
    } catch (err) {
        console.error('Erro ao atualizar o avatar:', err);
        res.status(500).json({ error: 'Erro ao salvar o avatar.' });
    }
});

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
router.get('/messages/:userId/:friendId', async (req, res) => {
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
