export interface KnownAttack {
    arrivalTick: number;
    starId: string;
    carriersOnTheWay: string[];
}

export interface InvasionInProgress {
    arrivalTick: number;
    star: string;
}

export enum DiplomaticGoal {
    Conquer = "Conquer",
    MakePeace = "MakePeace",
    BeFriendly = "BeFriendly"
}

export enum EconomicalGoal {
    Science = "Science",
    ShipProduction = "ShipProduction",
    Economy = "Economy",
    Weapons = "Weapons",
    Terraforming = "Terraforming"
}

export interface Goals {
    concerningPlayer: string;
    diploGoal: DiplomaticGoal;
    econGoals: EconomicalGoal[];
}

export interface AiState {
    knownAttacks: KnownAttack[];
    invasionsInProgress: InvasionInProgress[];
    startedClaims: string[];
    goals: Goals[]
}