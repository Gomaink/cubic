const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const User = require('../models/User');

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

        // Obtém o caminho absoluto do avatar no sistema de arquivos
        const avatarPath = req.file.path;

        // Excluir o avatar anterior se existir
        if (currentUser.avatarUrl) {
            const oldAvatarPath = path.join(__dirname, '..', 'public', currentUser.avatarUrl);
            fs.unlinkSync(oldAvatarPath); // Exclui o arquivo do sistema de arquivos
        }

        // Atualize o campo do caminho do avatar no documento do usuário
        currentUser.avatarUrl = avatarPath.replace('public\\', ''); // Salva o caminho sem o prefixo 'public/'
        await currentUser.save();

        res.json({ success: true, avatarUrl: currentUser.avatarUrl });
    } catch (err) {
        console.error('Erro ao atualizar o avatar:', err);
        res.status(500).json({ error: 'Erro ao salvar o avatar.' });
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


module.exports = router;