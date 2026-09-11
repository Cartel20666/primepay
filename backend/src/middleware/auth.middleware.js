const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (
            !authHeader ||
            typeof authHeader !== "string" ||
            !authHeader.startsWith("Bearer ")
        ) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const token = authHeader.slice(7).trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET,
            {
                algorithms: ["HS256"]
            }
        );

        if (
            !decoded ||
            !decoded.id ||
            typeof decoded.id !== "string"
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid authentication token."
            });
        }

        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User account not found."
            });
        }

        if (user.status !== "active") {
            return res.status(403).json({
                success: false,
                message: `Account is ${user.status}.`
            });
        }

        req.user = user;

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired authentication token."
        });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (
            !req.user ||
            !roles.includes(req.user.role)
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "You do not have permission to access this resource."
            });
        }

        next();
    };
};

module.exports = {
    protect,
    authorize
};
