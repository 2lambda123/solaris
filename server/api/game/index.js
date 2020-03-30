const express = require('express');
const router = express.Router();
const middleware = require('../middleware');
const container = require('../container');

router.get('/defaultSettings', middleware.authenticate, (req, res, next) => {
    return res.status(200).json(require('../config/game/defaultGameSettings.json'));
});

router.post('/', middleware.authenticate, async (req, res, next) => {
    req.body.general.createdByUserId = req.session.userId;

    try {
        let game = await container.gameCreateService.create(req.body);

        return res.status(201).json(game._id);
    } catch (err) {
        return next(err);
    }
});

router.get('/:gameId/info', middleware.authenticate, middleware.loadGameInfo, async (req, res, next) => {
    try {
        return res.status(200).json(req.game);
    } catch (err) {
        return next(err);
    }
});

router.get('/:gameId/galaxy', middleware.authenticate, async (req, res, next) => {
    try {
        let game = await container.gameGalaxyService.getGalaxy(req.params.gameId, req.session.userId);

        return res.status(200).json(game);
    } catch (err) {
        return next(err);
    }
});

router.get('/list/official', middleware.authenticate, async (req, res, next) => {
    try {
        let games = await container.gameListService.listOfficialGames();

        return res.status(200).json(games);
    } catch (err) {
        return next(err);
    }
});

router.get('/list/user', middleware.authenticate, async (req, res, next) => {
    try {
        let games = await container.gameListService.listUserGames();

        return res.status(200).json(games);
    } catch (err) {
        return next(err);
    }
});

router.get('/list/active', middleware.authenticate, async (req, res, next) => {
    try {
        let games = await container.gameListService.listActiveGames(req.session.userId);

        return res.status(200).json(games);
    } catch (err) {
        return next(err);
    }
});

router.get('/list/completed', middleware.authenticate, async (req, res, next) => {
    try {
        let games = await container.gameListService.listCompletedGames(req.session.userId);

        return res.status(200).json(games);
    } catch (err) {
        return next(err);
    }
});

router.post('/:gameId/join', middleware.authenticate, async (req, res, next) => {
    try {
        await container.gameService.join(
            req.params.gameId,
            req.session.userId,
            req.body.playerId,
            req.body.alias);

        return res.sendStatus(200);
    } catch (err) {
        return next(err);
    }
});

router.post('/:gameId/concedeDefeat', middleware.authenticate, async (req, res, next) => {
    try {
        await container.gameService.concedeDefeat(
            req.params.gameId,
            req.session.userId);
            
        return res.sendStatus(200);
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
