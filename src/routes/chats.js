const express = require('express');
const router = express.Router();


router.get('/', (req, res) => {
    if (req.session.userId) {
        return res.render('chats');
    }
    return res.redirect("/auth/login");
    res.render('chats');
});

module.exports = router;