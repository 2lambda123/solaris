const EventEmitter = require('events');
const mongoose = require('mongoose');
import { DBObjectId } from './types/DBObjectId';
import ValidationError from '../errors/validation';
import Repository from './repository';
import { Carrier } from './types/Carrier';
import { Game, GameSettings } from './types/Game';
import { Location } from './types/Location';
import { MapObject, MapObjectWithVisibility } from './types/Map';
import { Player } from './types/Player';
import { InfrastructureType, NaturalResources, Star, StarCaptureResult, TerraformedResources } from './types/Star';
import { User } from './types/User';
import DistanceService from './distance';
import GameStateService from './gameState';
import GameTypeService from './gameType';
import NameService from './name';
import RandomService from './random';
import SpecialistService from './specialist';
import StarDistanceService from './starDistance';
import TechnologyService from './technology';
import UserService from './user';
const RNG = require('random-seed');

export const StarServiceEvents = {
    onPlayerStarAbandoned: 'onPlayerStarAbandoned',
    onPlayerStarDied: 'onPlayerStarDied',
    onPlayerStarReignited: 'onPlayerStarReignited'
}

export default class StarService extends EventEmitter {

    gameRepo: Repository<Game>;
    randomService: RandomService;
    nameService: NameService;
    distanceService: DistanceService;
    starDistanceService: StarDistanceService;
    technologyService: TechnologyService;
    specialistService: SpecialistService;
    userService: UserService;
    gameTypeService: GameTypeService;
    gameStateService: GameStateService;

    constructor(
        gameRepo: Repository<Game>,
        randomService: RandomService,
        nameService: NameService,
        distanceService: DistanceService,
        starDistanceService: StarDistanceService,
        technologyService: TechnologyService,
        specialistService: SpecialistService,
        userService: UserService,
        gameTypeService: GameTypeService,
        gameStateService: GameStateService
    ) {
        super();

        this.gameRepo = gameRepo;
        this.randomService = randomService;
        this.nameService = nameService;
        this.distanceService = distanceService;
        this.starDistanceService = starDistanceService;
        this.technologyService = technologyService;
        this.specialistService = specialistService;
        this.userService = userService;
        this.gameTypeService = gameTypeService;
        this.gameStateService = gameStateService;
    }

    generateUnownedStar(name: string, location: Location, naturalResources: NaturalResources) {
        naturalResources = naturalResources || {
            economy: 0,
            industry: 0,
            science: 0
        };

        return {
            _id: mongoose.Types.ObjectId(),
            name,
            location,
            naturalResources,
            infrastructure: {
                economy: 0,
                industry: 0,
                science: 0
            }
        };
    }

    generateCustomGalaxyStar(name: string, star: Star) {
      return {
        _id: star._id,
        name: name,
        naturalResources: star.naturalResources,
        location: star.location,
        infrastructure: star.infrastructure,
        homeStar: star.homeStar,
        warpGate: star.warpGate,
        isNebula: star.isNebula,
        isAsteroidField: star.isAsteroidField,
        isBinaryStar: star.isBinaryStar,
        isBlackHole: star.isBlackHole,
        isPulsar: star.isPulsar,
        wormHoleToStarId: star.wormHoleToStarId,
        specialistId: star.specialistId
      }
    }

    generateStarPosition(game: Game, originX: number, originY: number, radius: number) {
        if (radius == null) {
            radius = game.constants.distances.maxDistanceBetweenStars;
        }

        return this.randomService.getRandomPositionInCircleFromOrigin(originX, originY, radius);
    }

    getById(game: Game, id: DBObjectId | string) {
        return this.getByIdBS(game, id); // Experimental
    }

    getByIdBS(game: Game, id: DBObjectId | string) {
        let start = 0;
        let end = game.galaxy.stars.length - 1;

        while (start <= end) {
            let middle = Math.floor((start + end) / 2);
            let star = game.galaxy.stars[middle];

            if (star._id.toString() === id.toString()) {
                // found the id
                return star;
            } else if (star._id.toString() < id.toString()) {
                // continue searching to the right
                start = middle + 1;
            } else {
                // search searching to the left
                end = middle - 1;
            }
        }

        // id wasn't found
        // Return the old way
        return game.galaxy.stars.find(s => s._id.toString() === id.toString())!;
    }

    setupHomeStar(game: Game, homeStar: Star, player: Player, gameSettings: GameSettings) {
        // Set up the home star
        player.homeStarId = homeStar._id;
        homeStar.ownedByPlayerId = player._id;
        homeStar.shipsActual = Math.max(gameSettings.player.startingShips, 1); // Must be at least 1 star at the home star so that a carrier can be built there.
        homeStar.ships = homeStar.shipsActual;
        homeStar.homeStar = true;
        homeStar.warpGate = false;
        homeStar.specialistId = null;

        this.resetIgnoreBulkUpgradeStatuses(homeStar);

        if (gameSettings.galaxy.galaxyType !== 'custom') { 
            homeStar.naturalResources.economy = game.constants.star.resources.maxNaturalResources;
            homeStar.naturalResources.industry = game.constants.star.resources.maxNaturalResources;
            homeStar.naturalResources.science = game.constants.star.resources.maxNaturalResources;
        }

        // Seed the home star with the starting infrastructure.
        homeStar.infrastructure.economy = gameSettings.player.startingInfrastructure.economy;
        homeStar.infrastructure.industry = gameSettings.player.startingInfrastructure.industry;
        homeStar.infrastructure.science = gameSettings.player.startingInfrastructure.science;
    }

    getPlayerHomeStar(stars: Star[], player: Player) {
        return this.listStarsOwnedByPlayer(stars, player._id).find(s => s._id.toString() === player.homeStarId!.toString());
    }

    listStarsOwnedByPlayer(stars: Star[], playerId: DBObjectId) {
        return stars.filter(s => s.ownedByPlayerId && s.ownedByPlayerId.toString() === playerId.toString());
    }

    listStarsOwnedByPlayers(stars: Star[], playerIds: DBObjectId[]) {
        const ids = playerIds.map(p => p.toString());

        return stars.filter(s => s.ownedByPlayerId && ids.includes(s.ownedByPlayerId.toString()));
    }

    isOwnedByPlayer(star: Star, player: Player) {
        return star.ownedByPlayerId && star.ownedByPlayerId.toString() === player._id.toString();
    }

    listStarsAliveOwnedByPlayer(stars: Star[], playerId: DBObjectId) {
        return this.listStarsOwnedByPlayer(stars, playerId).filter(s => !this.isDeadStar(s));
    }

    listStarIdsWithPlayerCarriersInOrbit(game: Game, playerId: DBObjectId): string[] {
        return game.galaxy.carriers
            .filter(c => c.orbiting)
            .filter(c => c.ownedByPlayerId!.toString() === playerId.toString())
            .map(c => c.orbiting!.toString());
    }

    listStarIdsWithPlayersCarriersInOrbit(game: Game, playerIds: DBObjectId[]): string[] {
        const ids = playerIds.map(p => p.toString());

        return game.galaxy.carriers
            .filter(c => c.orbiting)
            .filter(c => ids.includes(c.ownedByPlayerId!.toString()))
            .map(c => c.orbiting!.toString());
    }

    listStarsWithScanningRangeByPlayer(game: Game, playerId: DBObjectId): Star[] {
        let starIds: string[] = this.listStarsOwnedByPlayer(game.galaxy.stars, playerId).map(s => s._id.toString());

        if (game.settings.diplomacy.enabled === 'enabled') { // This never occurs when alliances is disabled.
            starIds = starIds.concat(this.listStarIdsWithPlayerCarriersInOrbit(game, playerId));
        }

        starIds = [...new Set(starIds)];

        return starIds
            .map(id => this.getById(game, id))
            .filter(s => !this.isDeadStar(s));
    }

    listStarsWithScanningRangeByPlayers(game: Game, playerIds: DBObjectId[]): Star[] {
        let starIds: string[] = this.listStarsOwnedByPlayers(game.galaxy.stars, playerIds).map(s => s._id.toString());

        if (game.settings.diplomacy.enabled === 'enabled') { // This never occurs when alliances is disabled.
            starIds = starIds.concat(this.listStarIdsWithPlayersCarriersInOrbit(game, playerIds));
        }

        starIds = [...new Set(starIds)];

        return starIds
            .map(id => this.getById(game, id))
            .filter(s => !this.isDeadStar(s));
    }

    listStarsOwnedOrInOrbitByPlayers(game: Game, playerIds: DBObjectId[]): Star[] {
        let starIds: string[] = this.listStarsOwnedByPlayers(game.galaxy.stars, playerIds).map(s => s._id.toString());

        if (game.settings.diplomacy.enabled === 'enabled') { // Don't need to check in orbit carriers if alliances is disabled
            starIds = starIds.concat(this.listStarIdsWithPlayersCarriersInOrbit(game, playerIds));
        }

        starIds = [...new Set(starIds)];

        return starIds
            .map(id => this.getById(game, id));
    }

    listStarsOwnedByPlayerBulkIgnored(stars: Star[], playerId: DBObjectId, infrastructureType: InfrastructureType) {
        return this.listStarsOwnedByPlayer(stars, playerId)
            .filter(s => s.ignoreBulkUpgrade![infrastructureType]);
    }

    isStarWithinScanningRangeOfStars(game: Game, star: Star, stars: Star[]) {
        // Pulsars are considered to be always in scanning range.
        // Note: They are not visible until the game starts to prevent pre-teaming.
        if (star.isPulsar && this.gameStateService.isStarted(game)) {
            return true;
        }

        // Go through all of the stars one by one and calculate
        // whether any one of them is within scanning range.
        for (let otherStar of stars) {
            if (otherStar.ownedByPlayerId == null) {
                continue;
            }

            // Use the effective scanning range of the other star to check if it can "see" the given star.
            let effectiveTechs = this.technologyService.getStarEffectiveTechnologyLevels(game, otherStar);
            let scanningRangeDistance = this.distanceService.getScanningDistance(game, effectiveTechs.scanning);
            let distance = this.starDistanceService.getDistanceBetweenStars(star, otherStar);

            if (distance <= scanningRangeDistance) {
                return true;
            }
        }

        return false;
    }

    filterStarsByScanningRange(game: Game, playerIds: DBObjectId[]) {
        // Stars may have different scanning ranges independently so we need to check
        // each star to check what is within its scanning range.
        let starsOwnedOrInOrbit = this.listStarsOwnedOrInOrbitByPlayers(game, playerIds);
        let starsWithScanning = starsOwnedOrInOrbit.filter(s => !this.isDeadStar(s));

        // Seed the stars that are in range to be the stars owned or are in orbit of.
        let starsInRange: MapObjectWithVisibility[] = starsOwnedOrInOrbit.map(s => {
            return {
                _id: s._id,
                location: s.location,
                ownedByPlayerId: s.ownedByPlayerId
            }
        });

        // Calculate which stars need to be checked excluding the ones that the player can definitely see.
        let starsToCheck: MapObjectWithVisibility[] = game.galaxy.stars
            .filter(s => starsInRange.find(r => r._id.toString() === s._id.toString()) == null)
            .map(s => {
                return {
                    _id: s._id,
                    location: s.location,
                    ownedByPlayerId: s.ownedByPlayerId,
                    isAlwaysVisible: s.isPulsar
                }
            });

        for (let star of starsWithScanning) {
            let starIds = this.getStarsWithinScanningRangeOfStarByStarIds(game, star, starsToCheck);

            for (let starId of starIds) {
                if (starsInRange.find(x => x._id.toString() === starId._id.toString()) == null) {
                    starsInRange.push(starId);
                    starsToCheck.splice(starsToCheck.indexOf(starId), 1);
                }
            }

            // If we've checked all stars then no need to continue.
            if (!starsToCheck.length) {
                break;
            }
        }

        // If worm holes are present, then ensure that any owned star OR star in orbit
        // also has its paired star visible.
        if (game.settings.specialGalaxy.randomWormHoles) {
            let wormHoleStars = starsOwnedOrInOrbit
                .filter(s => s.wormHoleToStarId)
                .map(s => {
                    return {
                        source: s,
                        destination: this.getById(game, s.wormHoleToStarId!)
                    };
                });
                
            for (let wormHoleStar of wormHoleStars) {
                if (starsInRange.find(s => s._id.toString() === wormHoleStar.destination._id.toString()) == null) {
                    starsInRange.push({
                        _id: wormHoleStar.destination._id,
                        location: wormHoleStar.destination.location,
                        ownedByPlayerId: wormHoleStar.destination.ownedByPlayerId
                    });
                }
            }
        }

        return starsInRange.map(s => this.getById(game, s._id));
    }

    filterStarsByScanningRangeAndWaypointDestinations(game: Game, playerIds: DBObjectId[]) {
        // Get all stars within the player's normal scanning vision.
        let starsInScanningRange = this.filterStarsByScanningRange(game, playerIds);

        const ids = playerIds.map(p => p.toString());

        // If in dark mode then we need to also include any stars that are 
        // being travelled to by carriers in transit for the current player.
        let inTransitStars = game.galaxy.carriers
            .filter(c => !c.orbiting)
            .filter(c => ids.includes(c.ownedByPlayerId!.toString()))
            .map(c => c.waypoints[0].destination)
            .map(d => this.getById(game, d));

        for (let transitStar of inTransitStars) {
            if (starsInScanningRange.indexOf(transitStar) < 0) {
                starsInScanningRange.push(transitStar);
            }
        }

        return starsInScanningRange;
    }

    getStarsWithinScanningRangeOfStarByStarIds(game: Game, star: Star, stars: MapObjectWithVisibility[]) {
        // If the star isn't owned then it cannot have a scanning range
        if (star.ownedByPlayerId == null) {
            return [];
        }

        // Calculate the scanning distance of the given star.
        let effectiveTechs = this.technologyService.getStarEffectiveTechnologyLevels(game, star, true);
        let scanningRangeDistance = this.distanceService.getScanningDistance(game, effectiveTechs.scanning);

        // Go through all stars and find each star that is in scanning range.
        let starsInRange = stars.filter(s => {
            return s.isAlwaysVisible || this.starDistanceService.getDistanceBetweenStars(s, star) <= scanningRangeDistance;
        });

        return starsInRange;
    }

    calculateActualNaturalResources(star: Star): NaturalResources {
        return {
            economy: Math.max(Math.floor(star.naturalResources.economy), 0),
            industry: Math.max(Math.floor(star.naturalResources.industry), 0),
            science: Math.max(Math.floor(star.naturalResources.science), 0)
        }
    }

    calculateTerraformedResources(star: Star, terraforming: number): TerraformedResources {
        return {
            economy: this.calculateTerraformedResource(star.naturalResources.economy, terraforming),
            industry: this.calculateTerraformedResource(star.naturalResources.industry, terraforming),
            science: this.calculateTerraformedResource(star.naturalResources.science, terraforming)
        }
    }

    calculateTerraformedResource(naturalResource: number, terraforming: number) {        
        return Math.floor(naturalResource + (5 * terraforming));
    }

    async abandonStar(game: Game, player: Player, starId: DBObjectId) {
        // Get the star.
        let star = game.galaxy.stars.find(x => x._id.toString() === starId.toString())!;

        // Check whether the star is owned by the player
        if ((star.ownedByPlayerId || '').toString() !== player._id.toString()) {
            throw new ValidationError(`Cannot abandon a star that is not owned by the player.`);
        }

        this.resetIgnoreBulkUpgradeStatuses(star);

        // Destroy the carriers owned by the player who abandoned the star.
        // Note: If an ally is currently in orbit then they will capture the star on the next tick.
        let playerCarriers = game.galaxy.carriers
            .filter(x => 
                x.orbiting
                && x.orbiting.toString() === star._id.toString()
                && x.ownedByPlayerId!.toString() === player._id.toString()
            );

        for (let playerCarrier of playerCarriers) {
            game.galaxy.carriers.splice(game.galaxy.carriers.indexOf(playerCarrier), 1);
        }

        star.ownedByPlayerId = null;
        star.shipsActual = 0;
        star.ships = star.shipsActual;

        await game.save();

        this.emit(StarServiceEvents.onPlayerStarAbandoned, {
            gameId: game._id,
            gameTick: game.state.tick,
            player,
            star
        });
    }

    isStarPairWormHole(sourceStar: Star, destinationStar: Star) {
        return sourceStar
            && destinationStar
            && sourceStar.wormHoleToStarId
            && destinationStar.wormHoleToStarId
            && sourceStar.wormHoleToStarId.toString() === destinationStar._id.toString()
            && destinationStar.wormHoleToStarId.toString() === sourceStar._id.toString();
    }

    canPlayersSeeStarShips(star: Star, playerIds: DBObjectId[]) {
        const ids = playerIds.map(p => p.toString());
        const isOwnedByPlayer = ids.includes((star.ownedByPlayerId || '').toString());

        if (isOwnedByPlayer) {
            return true;
        }

        // Nebula always hides ships for other players
        if (star.isNebula) {
            return false;
        }

        if (star.specialistId) {
            let specialist = this.specialistService.getByIdStar(star.specialistId);

            // If the star has a hideShips spec and is not owned by the given player
            // then that player cannot see the carrier's ships.
            if (specialist && specialist.modifiers.special && specialist.modifiers.special.hideShips) {
                return false;
            }
        }

        return true;
    }

    async claimUnownedStar(game: Game, gameUsers: User[], star: Star, carrier: Carrier) {
        if (star.ownedByPlayerId) {
            throw new ValidationError(`Cannot claim an owned star`);
        }

        star.ownedByPlayerId = carrier.ownedByPlayerId;

        this.resetIgnoreBulkUpgradeStatuses(star);

        // Weird scenario, but could happen.
        if (carrier.isGift) {
            carrier.isGift = false;
        }

        let carrierPlayer = game.galaxy.players.find(p => p._id.toString() === carrier.ownedByPlayerId!.toString())!;
        let carrierUser = gameUsers.find(u => carrierPlayer.userId && u._id.toString() === carrierPlayer.userId.toString()) || null;

        if (carrierUser && !carrierPlayer.defeated && !this.gameTypeService.isTutorialGame(game)) {
            carrierUser.achievements.combat.stars.captured++;

            if (star.homeStar) {
                carrierUser.achievements.combat.homeStars.captured++;
            }
        }
    }

    applyStarSpecialistSpecialModifiers(game: Game) {
        // NOTE: Specialist modifiers that affect stars on tick only apply
        // to stars that are owned by players. i.e NOT abandoned stars.
        for (let i = 0; i < game.galaxy.stars.length; i++) {
            let star = game.galaxy.stars[i];

            if (star.ownedByPlayerId) {
                if (star.specialistId) {
                    let specialist = this.specialistService.getByIdStar(star.specialistId);

                    if (specialist && specialist.modifiers.special) {
                        if (specialist.modifiers.special.addNaturalResourcesOnTick) {
                            this.addNaturalResources(game, star, specialist.modifiers.special.addNaturalResourcesOnTick);
                        }
                    }
                }
            }
        }
    }

    isDeadStar(star: Star) {
        if (!star.naturalResources) {
            return true;
        }
        
        return star.naturalResources.economy <= 0 && star.naturalResources.industry <= 0 && star.naturalResources.science <= 0;
    }

    addNaturalResources(game: Game, star: Star, amount: number) {
        let wasDeadStar = this.isDeadStar(star);

        if (this.gameTypeService.isSplitResources(game)) {
            let total = star.naturalResources.economy + star.naturalResources.industry + star.naturalResources.science;

            star.naturalResources.economy += 3 * amount * (star.naturalResources.economy / total);
            star.naturalResources.industry += 3 * amount * (star.naturalResources.industry / total);
            star.naturalResources.science += 3 * amount * (star.naturalResources.science / total);
        } else {
            star.naturalResources.economy += amount;
            star.naturalResources.industry += amount;
            star.naturalResources.science += amount;
        }

        // TODO: Allow negative values here so we can keep the ratio.
        if (Math.floor(star.naturalResources.economy) <= 0) {
            star.naturalResources.economy = 0;
        }

        if (Math.floor(star.naturalResources.industry) <= 0) {
            star.naturalResources.industry = 0;
        }

        if (Math.floor(star.naturalResources.science) <= 0) {
            star.naturalResources.science = 0;
        }
        
        // if the star reaches 0 of all resources then reduce the star to a dead hunk.
        if(this.isDeadStar(star)) {
            star.specialistId = null;
            star.warpGate = false;
            star.infrastructure.economy = 0;
            star.infrastructure.industry = 0;
            star.infrastructure.science = 0;

            if (star.ownedByPlayerId) {
                this.emit(StarServiceEvents.onPlayerStarDied, {
                    gameId: game._id,
                    gameTick: game.state.tick,
                    playerId: star.ownedByPlayerId,
                    starId: star._id,
                    starName: star.name
                });
            }
        }
        // If it was a dead star but is now not a dead star then it has been reignited.
        else if (wasDeadStar && star.ownedByPlayerId) {
            this.emit(StarServiceEvents.onPlayerStarReignited, {
                gameId: game._id,
                gameTick: game.state.tick,
                playerId: star.ownedByPlayerId,
                starId: star._id,
                starName: star.name
            });
        }
    }

    reigniteDeadStar(game: Game, star: Star, naturalResources: NaturalResources) {
        if (!this.isDeadStar(star)) {
            throw new Error('The star cannot be reignited, it is not dead.');
        }

        star.naturalResources = naturalResources;

        if (star.ownedByPlayerId) {
            this.emit(StarServiceEvents.onPlayerStarReignited, {
                gameId: game._id,
                gameTick: game.state.tick,
                playerId: star.ownedByPlayerId,
                starId: star._id,
                starName: star.name
            });
        }
    }

    destroyStar(game: Game, star: Star) {
        game.galaxy.stars.splice(game.galaxy.stars.indexOf(star), 1);

        game.state.stars--;

        // If the star was paired with a worm hole, then clear the other side.
        if (star.wormHoleToStarId) {
            const wormHolePairStar = this.getById(game, star.wormHoleToStarId);

            if (wormHolePairStar) {
                wormHolePairStar.wormHoleToStarId = null;
            }
        }

        // Recalculate how many stars are needed for victory in conquest mode.
        if (game.settings.general.mode === 'conquest') {
            // TODO: Find a better place for this as its shared in the gameCreate service.
            switch (game.settings.conquest.victoryCondition) {
                case 'starPercentage':
                    game.state.starsForVictory = Math.ceil((game.state.stars / 100) * game.settings.conquest.victoryPercentage);
                    break;
                case 'homeStarPercentage':
                    game.state.starsForVictory = Math.ceil((game.settings.general.playerLimit / 100) * game.settings.conquest.victoryPercentage);
                    break;
                default:
                    throw new Error(`Unsupported conquest victory condition: ${game.settings.conquest.victoryCondition}`)
            }
        }
    }

    async toggleIgnoreBulkUpgrade(game: Game, player: Player, starId: DBObjectId, infrastructureType: InfrastructureType) {
        let star = this.getById(game, starId);

        if (!star.ownedByPlayerId || star.ownedByPlayerId.toString() !== player._id.toString()) {
            throw new ValidationError(`You do not own this star.`);
        }

        let newValue = star.ignoreBulkUpgrade![infrastructureType] ? false : true;

        let updateObject = {
            $set: {}
        };

        updateObject['$set'][`galaxy.stars.$.ignoreBulkUpgrade.${infrastructureType}`] = newValue

        await this.gameRepo.updateOne({
            _id: game._id,
            'galaxy.stars._id': starId
        }, updateObject);
    }

    async toggleIgnoreBulkUpgradeAll(game: Game, player: Player, starId: DBObjectId, ignoreStatus: boolean) {
        let star = this.getById(game, starId);

        if (!star.ownedByPlayerId || star.ownedByPlayerId.toString() !== player._id.toString()) {
            throw new ValidationError(`You do not own this star.`);
        }

        await this.gameRepo.updateOne({
            _id: game._id,
            'galaxy.stars._id': starId
        }, {
            $set: {
                'galaxy.stars.$.ignoreBulkUpgrade.economy': ignoreStatus,
                'galaxy.stars.$.ignoreBulkUpgrade.industry': ignoreStatus,
                'galaxy.stars.$.ignoreBulkUpgrade.science': ignoreStatus
            }
        });
    }

    captureStar(game: Game, star: Star, owner: Player, defenders: Player[], defenderUsers: User[], attackers: Player[], attackerUsers: User[], attackerCarriers: Carrier[]): StarCaptureResult {
        const isTutorialGame = this.gameTypeService.isTutorialGame(game);

        let specialist = this.specialistService.getByIdStar(star.specialistId);

        // If the star had a specialist that destroys infrastructure then perform demolition.
        if (specialist && specialist.modifiers.special && specialist.modifiers.special.destroyInfrastructureOnLoss) {
            star.specialistId = null;
            star.infrastructure.economy = 0;
            star.infrastructure.industry = 0;
            star.infrastructure.science = 0;
            star.warpGate = false;
        }

        // If multiple players are capturing the star, then the player who owns the carrier with the most
        // ships will capture it, otherwise the closest carrier gets it.
        let capturePlayerId = attackerCarriers.sort((a, b) => {
            // Sort by ship count (highest ships first)
            if (a.ships! > b.ships!) return -1;
            if (a.ships! < b.ships!) return 1;

            // Then by distance (closest carrier first)
            return (a.distanceToDestination || 0) - (b.distanceToDestination || 0);
        })[0].ownedByPlayerId!;

        // Capture the star.
        let newStarPlayer = attackers.find(p => p._id.toString() === capturePlayerId.toString())!;
        let newStarUser = attackerUsers.find(u => newStarPlayer.userId && u._id.toString() === newStarPlayer.userId.toString());
        let newStarPlayerCarriers = attackerCarriers.filter(c => c.ownedByPlayerId!.toString() === newStarPlayer._id.toString());

        star.ownedByPlayerId = newStarPlayer._id;
        star.shipsActual = 0;
        star.ships = 0;

        // If star capture reward is enabled, destroy the economic infrastructure
        // and add the capture amount to the attacker
        let captureReward = 0;

        if (game.settings.specialGalaxy.starCaptureReward === 'enabled') {
            captureReward = star.infrastructure.economy! * game.constants.star.captureRewardMultiplier; // Attacker gets X credits for every eco destroyed.
    
            // Check to see whether to double the capture reward.
            let captureRewardMultiplier = this.specialistService.hasAwardDoubleCaptureRewardSpecialist(newStarPlayerCarriers);
    
            captureReward = Math.floor(captureReward * captureRewardMultiplier);

            newStarPlayer.credits += captureReward;

            star.infrastructure.economy = 0;
        }

        // Reset the ignore bulk upgrade statuses as it has been captured by a new player.
        this.resetIgnoreBulkUpgradeStatuses(star);

        const oldStarUser = defenderUsers.find(u => owner.userId && u._id.toString() === owner.userId.toString()) || null;

        if (!isTutorialGame) {
            if (oldStarUser && !owner.defeated) {
                oldStarUser.achievements.combat.stars.lost++;
    
                if (star.homeStar) {
                    oldStarUser.achievements.combat.homeStars.lost++;
                }
            }
            
            if (newStarUser && !newStarPlayer.defeated) {
                newStarUser.achievements.combat.stars.captured++;
    
                if (star.homeStar) {
                    newStarUser.achievements.combat.homeStars.captured++;
                }
            }
        }

        if (this.gameTypeService.isKingOfTheHillMode(game) && 
            this.gameStateService.isCountingDownToEndInLastCycle(game) &&
            this.isKingOfTheHillStar(star)) {
            this.gameStateService.setCountdownToEndToOneCycle(game);
        }

        return {
            capturedById: newStarPlayer._id,
            capturedByAlias: newStarPlayer.alias!,
            captureReward
        };
    }

    resetIgnoreBulkUpgradeStatuses(star: Star) {
        star.ignoreBulkUpgrade = {
            economy: false,
            industry: false,
            science: false
        }

        return star.ignoreBulkUpgrade;
    }

    listHomeStars(game: Game) {
        return game.galaxy.stars.filter(s => s.homeStar);
    }

    getKingOfTheHillStar(game: Game) {
        const center = this.starDistanceService.getGalacticCenter();

        return game.galaxy.stars.find(s => s.location.x === center.x && s.location.y === center.y)!;
    }

    isKingOfTheHillStar(star: Star) {
        const center = this.starDistanceService.getGalacticCenter();

        return star.location.x === center.x && star.location.y === center.y;
    }

    setupPlayerStarForGameStart(game: Game, star: Star, player: Player) {
        if (player.homeStarId!.toString() === star._id.toString()) {
            this.setupHomeStar(game, star, player, game.settings);
        } else {
            star.ownedByPlayerId = player._id;
            star.shipsActual = game.settings.player.startingShips;
            star.ships = star.shipsActual;
            star.warpGate = false; // TODO: BUG - This resets warp gates generated by map terrain.
            star.specialistId = null;

            if (game.settings.player.developmentCost.economy !== 'none') {
                star.infrastructure.economy = 0;
            }

            if (game.settings.player.developmentCost.industry !== 'none') {
                star.infrastructure.industry = 0;
            }

            if (game.settings.player.developmentCost.science !== 'none') {
                star.infrastructure.science = 0;
            }

            this.resetIgnoreBulkUpgradeStatuses(star);
        }
    }

    setupStarsForGameStart(game: Game) {
        // If any of the development costs are set to null then we need to randomly
        // assign a portion of stars for each type to be seeded with the starting infrastructure.
        // For example, if eco is disabled then each star in the galaxy will have a 1 in 3 chance of being seeded with eco.
        // Note that we will not allow a mix of seeds, a star can only be seeded with one infrastructure type.
        if (game.settings.player.developmentCost.economy !== 'none' &&
            game.settings.player.developmentCost.industry !== 'none' &&
            game.settings.player.developmentCost.science !== 'none') {
                return
            }
        
        // Note: Because each setting is independent, we only want to seed the
        // ones where the development cost is set to none.
        const types: (InfrastructureType | null)[] = [
            game.settings.player.developmentCost.economy === 'none' ? 'economy' : null,
            game.settings.player.developmentCost.industry === 'none' ? 'industry' : null,
            game.settings.player.developmentCost.science === 'none' ? 'science' : null,
        ]

        const rng = RNG.create(game._id.toString());

        for (let star of game.galaxy.stars) {
            const i = rng(types.length);
            const type = types[i];

            if (type == null) {
                continue;
            }

            star.infrastructure[type] = game.settings.player.startingInfrastructure[type];
        }
    }

    pairWormHoleConstructors(game: Game) {
        const constructors = game.galaxy.stars
            .filter(s => s.specialistId && this.specialistService.getByIdStar(s.specialistId)?.modifiers.special?.wormHoleConstructor);

        let pairs = Math.floor(constructors.length / 2);

        if (pairs < 1) {
            return;
        }

        while (pairs--) {
            const starA = constructors[this.randomService.getRandomNumber(constructors.length)];
            const starB = constructors[this.randomService.getRandomNumber(constructors.length)];

            if (starA._id.toString() === starB._id.toString() || starA.wormHoleToStarId || starB.wormHoleToStarId) {
                pairs++;
                continue;
            }

            starA.wormHoleToStarId = starB._id;
            starB.wormHoleToStarId = starA._id;

            starA.specialistId = null;
            starB.specialistId = null;
        }
    }
}
