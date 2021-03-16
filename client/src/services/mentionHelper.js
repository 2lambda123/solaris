import gameHelper from './gameHelper.js'

class MentionHelper {
  static MENTION_REGEX = /{{(.+?):(.+?)}}/g
  static INTERNAL_MENTION_REGEX = /{{(\w)\/(\w+?)\/(.+?)}}/g

  addMention(conversation, type, name) {
    const text = conversation.text || ''
    const element = conversation.element

    //Do not use and for property access here because a selection start of 0 would be false
    const insertionStart = element ? element.selectionStart : (text.length - 1)
    const insertionEnd = element ? element.selectionEnd : text.length

    this.addMentionFromTo(conversation, type, name, insertionStart, insertionEnd)
  }

  addMentionFromTo (conversation, type, name, start, end) {
    const text = conversation.text || ''
    const element = conversation.element

    const mention = `{{${type}:${name}}}`
    const newText = text.substring(0, start) + mention + text.substring(end)

    conversation.text = newText

    if (element) {
      element.setSelectionRange(start, start + mention.length)
      element.focus()
    }
  }

  makeMentionsStatic(game, originalText) {
    return originalText.replaceAll(MentionHelper.MENTION_REGEX, (match, typeGroup, nameGroup) => {
      if (typeGroup === 'star') {
        return this.makeStarMentionStatic(game, nameGroup)
      } else if (typeGroup === 'player') {
        return this.makePlayerMentionStatic(game, nameGroup)
      } else {
        return match
      }
    })
  }

  makePlayerMentionStatic(game, playerName) {
    const player = gameHelper.getPlayerByAlias(game, playerName)

    if (player) {
      return this.makeStaticMention('p', player._id, playerName)
    } else {
      return playerName
    }
  }

  makeStarMentionStatic(game, starName) {
    const star = gameHelper.getStarByName(game, starName)

    if (star) {
      return this.makeStaticMention('s', star._id, starName)
    } else {
      return starName
    }
  }

  makeStaticMention(type, id, name) {
    return `{{${type}/${id}/${name}}}`
  }

  replaceMentionsWithNames(message) {
    return message.replace(MentionHelper.INTERNAL_MENTION_REGEX, (_match, _type, _id, name) => name)
  }

  renderMessageWithMentions(element, message, onStarClickedCallback, onPlayerClickedCallback) {
    let lastMentionEnd = 0

    for (const match of message.matchAll(MentionHelper.INTERNAL_MENTION_REGEX)) {
      const text = message.substring(lastMentionEnd, match.index)

      if (text) {
        const node = document.createTextNode(text)

        element.appendChild(node)
      }

      lastMentionEnd = match.index + match[0].length

      const linkElement = this.createMentionLinkElement(match[1], match[2], match[3], onStarClickedCallback, onPlayerClickedCallback)

      element.appendChild(linkElement)
    }

    const lastText = message.substring(lastMentionEnd)

    if (lastText) {
      const node = document.createTextNode(lastText)

      element.appendChild(node)
    }
  }

  createMentionLinkElement(type, id, name, onStarClickedCallback, onPlayerClickedCallback) {
    const node = document.createElement("a")

    //Set href attribute so styles are applied properly
    node.setAttribute("href", "javascript:void(0)")
    node.text = name

    switch (type) {
      case 's':
        node.onclick = () => {
          onStarClickedCallback(id) 
        }
        break
      case 'p':
        node.onclick = () => { 
          onPlayerClickedCallback(id) 
        }
        break
    }

    return node
  }

  tryBeginMention (conversation, key, suggestionsEnabled) {
    if (!conversation.currentMention) {
      const suggestionType = this.getMentionType(key)
      if (suggestionType) {
        conversation.currentMention = {
          suggestionType,
          mentionStart: conversation.element.selectionStart,
          text: ''
        }
      }
    }
  }

  endMention (conversation) {
    const { suggestionType, text, mentionStart } = conversation.currentMention
    //Offset of 1 for * or @
    console.log("END SUGGESTION: " + text)
    this.addMentionFromTo(conversation, suggestionType, text, mentionStart, mentionStart + text.length + 1)
    conversation.currentMention = null
  }

  getMentionType (character) {
    if (character === '*') {
      return 'star'
    } else if (character === '@') {
      return 'player'
    } else {
      return null
    }
  }

  updateMention (conversation, suggestionsEnabled) {
    const newMentionText = this.getToCursor(conversation, conversation.currentMention.mentionStart + 1)
    const lastCharacter = newMentionText[newMentionText.length - 1]
    if (lastCharacter && !lastCharacter.trim()) {
      this.endMention(conversation)
    } else {
      conversation.currentMention.text = newMentionText
    }
  }

  getToCursor (conversation, from) {
    const element = conversation.element
    const text = conversation.text || ''
    const cursorPos = element ? element.selectionEnd : text.length
    return text.substring(from, cursorPos + 2)
  }
}

export default new MentionHelper()