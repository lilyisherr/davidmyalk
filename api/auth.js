const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('../models/User'); // Assuming there is a User model

// Login function
const login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).send('User not found');
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).send('Invalid credentials');
        const token = jwt.sign({ id: user._id }, 'your_jwt_secret'); // Use an environment variable
        return res.json({ token });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
};

// Signup function
const signup = async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();
        return res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { login, signup };