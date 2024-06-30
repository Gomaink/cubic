const express = require('express')
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');

const authenticationRouter = require('./routes/auth');
app.use("/auth", authenticationRouter);

app.get("/", (req, res) => {
    res.render("index");
});

app.get("/another", (req, res) => {
    res.render("another-page");
});

app.listen(port, () => console.log(`Server running on port ${port}.`))