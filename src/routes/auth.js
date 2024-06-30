const express = require('express')
const router = express.Router()

router.get("/login", (req, res) => {
    /*if (req.session.userId) {
        return res.redirect("/");
    }*/
    res.render("login");
});

router.get("/register", (req, res) => {
    /*if (req.session.userId) {
        return res.redirect("/");
    }*/
    res.render("register");
});

module.exports = router;