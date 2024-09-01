const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const Token = require('../models/Token');
const Friendship = require('../models/Friendship');
const UserConfigs = require('../models/UserConfigs');

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

//Update a user username
router.post('/update-username', async (req, res) => {
    const { userId, newUsername } = req.body;

    try {
        const existingUsername = await User.findOne({ username: newUsername });
        
        if (existingUsername) {
            return res.render('register', { error: 'Este nome de usuário já está em uso.' });
        }

        const user = await User.findByIdAndUpdate(userId, { username: newUsername }, { new: true });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        res.status(200).json({ success: true, message: 'Nome de usuário atualizado com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao atualizar nome de usuário. Tente novamente.' });
    }
});


// Update a user nickname
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

//Update a user avatar
router.post('/upload-avatar', upload.single('avatar'), async (req, res, next) => {
    try {
        const currentUser = await User.findById(req.session.userId);

        if (!currentUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const avatarPath = req.file.path;

        if (currentUser.avatarUrl) {
            const oldAvatarPath = path.join(__dirname, '..', 'public', currentUser.avatarUrl);
            fs.unlinkSync(oldAvatarPath); 
        }

        currentUser.avatarUrl = avatarPath.replace('public\\', ''); 
        await currentUser.save();

        res.json({ success: true, avatarUrl: currentUser.avatarUrl });
    } catch (err) {
        console.error('Erro ao atualizar o avatar:', err);
        res.status(500).json({ error: 'Erro ao salvar o avatar.' });
    }
});

//Update email
router.post('/update-email', async (req, res) => {
    const { newEmail } = req.body;

    try {
        const userId = await User.findById(req.session.userId);

        const existingUser = await User.findOne({ email: newEmail });
        if (existingUser && existingUser._id.toString() !== userId) {
            return res.status(400).json({ error: 'O e-mail já está em uso.' });
        }

        const user = await User.findByIdAndUpdate(userId, { email: newEmail }, { new: true });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        res.status(200).json({ success: true, message: 'E-mail atualizado com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao atualizar e-mail. Tente novamente.' });
    }
});

//Update password
router.post('/update-password', async (req, res) => {
    const { newPassword } = req.body;

    try {
        const userId = await User.findById(req.session.userId);

        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const updatePassword = await User.findByIdAndUpdate(userId, { password: newPassword }, { new: true });

        if (!updatePassword) {
            return res.status(404).json({ error: 'Usuário não encontrado ou ocorreu um erro ao atualizar a senha.' });
        }

        res.status(200).json({ success: true, message: 'Senha atualizada com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao atualizar a senha. Tente novamente.' });
    }
});

// Verify password
router.post('/verify-password', async (req, res) => {
    const { currentPassword } = req.body;
    const userId = req.session.userId;

    try {
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const isMatch = await user.comparePassword(currentPassword);

        if (isMatch) {
            res.status(200).json({ success: true });
        } else {
            res.status(401).json({ error: 'Senha atual incorreta.' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao verificar a senha. Tente novamente.' });
    }
});


//Update a PeerID
router.post('/update-peerid', async (req, res) => {
    const { userId, peerid } = req.body;

    try {
        const user = await User.findByIdAndUpdate(userId, { peerid: peerid }, { new: true });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        res.status(200).json({ success: true, message: 'PeerID atualizado com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao atualizar PeerID. Tente novamente.' });
    }
});

//Delete account
router.post('/delete-account', async (req, res) => {
    const { currentPassword } = req.body;
    const userId = req.session.userId;

    try {
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const isMatch = await user.comparePassword(currentPassword);

        if (!isMatch) {
            return res.status(401).json({ error: 'Senha atual incorreta.' });
        }

        await FriendRequest.deleteMany({
            $or: [{ requester: userId }, { recipient: userId }]
        });

        await Token.deleteMany({ userId: userId });

        await Friendship.deleteMany({ user: userId });
        await Friendship.updateMany({ friends: userId }, { $pull: { friends: userId } });

        await user.deleteOne();

        res.status(200).json({ success: true, message: 'Conta deletada com sucesso.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Erro ao deletar a conta. Tente novamente.' });
    }
});

router.post('/configs/save', async (req, res) => {
    const { userId, inputVolume, outputVolume } = req.body;

    try {
        let userConfig = await UserConfigs.findOne({ userId });

        if (userConfig) {
            userConfig.inputVolume = inputVolume;
            userConfig.outputVolume = outputVolume;
        } else {
            userConfig = new UserConfigs({ userId, inputVolume, outputVolume });
        }

        await userConfig.save();
        res.status(200).json({ success: true, message: 'Configurações salvas com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/configs/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const userConfig = await UserConfigs.findOne({ userId });

        if (userConfig) {
            res.status(200).json(userConfig);
        } else {
            res.status(404).json({ success: false, message: 'Configurações não encontradas.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;