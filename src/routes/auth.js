const express = require('express');
const router = express.Router();
const User = require('../models/User');


router.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect("/");
    }
    res.render('login');
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Email or username match
        const user = await User.findOne({ $or: [{ email }, { username: email }] });
        if (!user) {
            return res.render('login', { error: 'Credenciais inválidas.' });
        }

        // Password verify
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.render('login', { error: 'Credenciais inválidas.' });
        }

        req.session.userId = user._id;
        res.redirect('/'); 
    } catch (err) {
        console.error(err);
        return res.render('login', { error: 'Erro ao fazer login. Tente novamente mais tarde.' });
    }
});

router.get('/register', (req, res) => {
    if (req.session.userId) {
        return res.redirect("/");
    }
    res.render('register');
});

router.post('/register', async (req, res) => {
    const { email, username, nickname, password, day, month, year } = req.body;

    try {
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
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'Erro ao registrar o usuário. Por favor, tente novamente mais tarde.' });
    }
});

module.exports = router;
