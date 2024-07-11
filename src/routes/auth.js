const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Token = require('../models/Token');
require('dotenv').config();

// Configure nodemailer
const transporter = nodemailer.createTransport({
    service: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: 'cubicgamingco@gmail.com',
        pass: process.env.GMAIL_APPKEY
    }
});

router.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect("/chats");
    }
    res.render('login');
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Email or username match
        const user = await User.findOne({ $or: [{ email }, { username: email }] });
        if (!user) {
            return res.render('login', { error: 'E-mail ou senha incorretos.' });
        }

        // Password verify
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.render('login', { error: 'E-mail ou senha incorretos.' });
        }

        req.session.userId = user._id;
        res.redirect('/chats'); 
    } catch (err) {
        console.error(err);
        return res.render('login', { error: 'Erro ao fazer login. Tente novamente mais tarde.' });
    }
});

router.get('/register', (req, res) => {
    if (req.session.userId) {
        return res.redirect("/chats");
    }
    res.render('register');
});

router.post('/register', async (req, res) => {
    const { email, username, nickname, password, day, month, year } = req.body;

    try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

        if (!emailRegex.test(email)) {
            return res.render('register', { error: 'E-mail inválido.' });
        }

        if (!passwordRegex.test(password)) {
            return res.render('register', { error: 'A senha deve ter pelo menos 8 caracteres, incluindo uma letra e um número.' });
        }

        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
            return res.render('register', { error: 'Este nome de usuário já está em uso.' });
        }

        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.render('register', { error: 'Este e-mail já está em uso.' });
        }

        const newUser = new User({
            email,
            username,
            nickname,
            password,
            birthdate: { day, month, year }
        });
        await newUser.save();
        
        req.session.userId = newUser._id;
        res.redirect('/chats');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'Erro ao registrar o usuário. Por favor, tente novamente mais tarde.' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Erro ao fazer logout:', err);
            return res.redirect('/');
        }
        res.redirect('/auth/login');
    });
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });

        if (!user) {
            return res.json({ error: 'E-mail não cadastrado.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expiration = Date.now() + 15 * 60 * 1000; // 15 minutos

        await new Token({
            userId: user._id,
            token,
            expiration
        }).save();

        const resetLink = `http://localhost:3000/auth/forgot-password/${token}`;

        const mailOptions = {
            from: 'seuemail@gmail.com',
            to: user.email,
            subject: 'Redefinir Senha',
            html: `<p>Você solicitou uma redefinição de senha.</p>
                   <p>Clique no link abaixo para redefinir sua senha:</p>
                   <a href="${resetLink}">${resetLink}</a>`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                return res.json({ error: `Erro ao enviar e-mail. Por favor, tente novamente.\n${error}` });
            } else {
                return res.json({ success: true });
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.get('/forgot-password/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const tokenDoc = await Token.findOne({ token, expiration: { $gt: Date.now() } });

        if (!tokenDoc) {
            return res.status(404).redirect('/error?error=404&errorMessage=Token inválido ou expirado.');
        }

        res.render('password', { token });
    } catch (error) {
        console.error(error);
        return res.status(500).redirect('/error?error=500&errorMessage=Erro interno do servidor.');
    }
});

router.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { newPassword, confirmNewPassword } = req.body;

    if (!newPassword || !confirmNewPassword) {
        return res.status(400).json({ error: 'Os campos de senha são obrigatórios.' });
    }

    if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ error: 'As senhas não coincidem.' });
    }

    try {
        const tokenDoc = await Token.findOne({ token, expiration: { $gt: Date.now() } });

        if (!tokenDoc) {
            return res.status(404).redirect('/error?error=404&errorMessage=Token inválido ou expirado.');
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        const user = await User.findByIdAndUpdate(tokenDoc.userId, { password: hashedPassword }, { new: true });

        if (!user) {
            return res.status(400).json({ error: 'Usuário não encontrado.' });
        }

        await Token.deleteOne({ _id: tokenDoc._id });

        res.redirect('/auth/login', {error: 'Senha alterada com sucesso.'});
    } catch (error) {
        console.error(error);
        return res.status(500).redirect('/error?error=500&errorMessage=Erro interno do servidor.');
    }
});

module.exports = router;
