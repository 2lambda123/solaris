import { DBObjectId } from "./DBObjectId";

export interface ConversationMessage {
    _id: DBObjectId;
    fromPlayerId: DBObjectId;
    fromPlayerAlias: string;
    message: string;
    sentDate: Date;
    sentTick: number | null;
    pinned: boolean;
    readBy: DBObjectId[];

    type?: 'message'|'event';
};

export interface ConversationMessageSentResult extends ConversationMessage {
    conversationId: DBObjectId;
    toPlayerIds: DBObjectId[];
};
