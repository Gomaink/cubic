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

router.get('/check-auth', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ authenticated: true, userId: req.session.userId });
    } else {
        res.json({ authenticated: false });
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

        // Verifica se existe um token ativo para o usuário
        const existingToken = await Token.findOne({
            userId: user._id,
            expiration: { $gt: Date.now() }
        });

        if (existingToken) {
            // Se existir, retorna um erro indicando que já há um pedido ativo
            return res.json({ error: 'Já há um pedido de redefinição de senha ativo para este usuário.' });
        }

        // Deleta qualquer token expirado para o usuário
        await Token.deleteMany({
            userId: user._id,
            expiration: { $lte: Date.now() }
        });

        // Salva o novo token no banco de dados
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
            html: `<!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Redefinição de Senha</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f0f0f0;
                        margin: 0;
                        padding: 0;
                    }
                    .container {
                        max-width: 400px;
                        margin: 20px auto;
                        padding: 20px;
                        background-color: #ffffff;
                        border: 1px solid #cccccc;
                        border-radius: 5px;
                    }
                    .btn {
                        display: inline-block;
                        font-weight: bold;
                        padding: 10px 20px;
                        text-decoration: none;
                        background-color: #007bff;
                        color: #ffffff;
                        border-radius: 4px;
                    }
                    .btn:hover {
                        background-color: #0056b3;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2 style="color: #000;">Redefinição de senha.</h2>
                    <hr>
                    <p style="color: #000; font-size: 16px;">Você solicitou uma redefinição de senha.</p>
                    <p style="color: #000; font-size: 16px;">Caso não tenha sido você que solicitou, ignore este e-mail.</p>
                    <p style="color: #000; font-size: 16px;">Clique no botão abaixo para redefinir sua senha:</p>
                    <a href="${resetLink}" style="color: #fff;" class="btn">Alterar senha</a>
                </div>
            </body>
            </html>`
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

        res.status(200).redirect('/auth/login?error=Senha alterada com sucesso.');
    } catch (error) {
        console.error(error);
        return res.status(500).redirect('/error?error=500&errorMessage=Erro interno do servidor.');
    }
});

module.exports = router;
