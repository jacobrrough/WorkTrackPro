import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatService } from '@/services/api/chat';
import { encryptionKeyService } from '@/services/api/encryptionKeys';
import {
  encryptMessage,
  encryptFile as encryptFileData,
  generateConversationKey,
  encryptConversationKeyForMember,
  decryptConversationKey,
} from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import type { Conversation, Message } from '@/core/types';

async function getOrDecryptConversationKey(
  conversationId: string,
  creatorPublicKeyBase64: string
): Promise<CryptoKey> {
  const cached = cryptoKeyCache.getConversationKey(conversationId);
  if (cached) return cached;

  const privateKey = cryptoKeyCache.getPrivateKey();
  if (!privateKey) throw new Error('Encryption keys not unlocked');

  const keyData = await chatService.getMyConversationKey(conversationId);
  if (!keyData) throw new Error('No conversation key found');

  const convKey = await decryptConversationKey(
    keyData.encryptedKey,
    keyData.keyIv,
    privateKey,
    creatorPublicKeyBase64
  );
  cryptoKeyCache.setConversationKey(conversationId, convKey);
  return convKey;
}

export function useChatMutations() {
  const queryClient = useQueryClient();

  const sendTextMessage = useCallback(
    async (
      conversationId: string,
      plaintext: string,
      creatorPublicKeyBase64: string
    ): Promise<Message | null> => {
      try {
        const convKey = await getOrDecryptConversationKey(conversationId, creatorPublicKeyBase64);
        const { ciphertext, iv } = await encryptMessage(plaintext, convKey);
        const msg = await chatService.sendMessage({
          conversationId,
          encryptedContent: ciphertext,
          contentIv: iv,
          messageType: 'text',
        });
        msg.decryptedContent = plaintext;
        queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
        queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        return msg;
      } catch (e) {
        console.error('Failed to send message:', e);
        return null;
      }
    },
    [queryClient]
  );

  const sendFileMessage = useCallback(
    async (
      conversationId: string,
      file: File,
      creatorPublicKeyBase64: string
    ): Promise<Message | null> => {
      try {
        const convKey = await getOrDecryptConversationKey(conversationId, creatorPublicKeyBase64);
        const fileBuffer = await file.arrayBuffer();
        const { encryptedBlob, encryptedFileKey, fileIv, fileKeyIv } = await encryptFileData(
          fileBuffer,
          convKey
        );

        const metadata = JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        });
        const { ciphertext, iv } = await encryptMessage(metadata, convKey);

        const msg = await chatService.sendMessage({
          conversationId,
          encryptedContent: ciphertext,
          contentIv: iv,
          messageType: 'file',
        });

        await chatService.uploadAttachment({
          messageId: msg.id,
          conversationId,
          encryptedFile: encryptedBlob,
          encryptedFileKey,
          fileKeyIv,
          fileIv,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
        });

        msg.decryptedContent = metadata;
        queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
        queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        return msg;
      } catch (e) {
        console.error('Failed to send file:', e);
        return null;
      }
    },
    [queryClient]
  );

  const createDirectConversation = useCallback(
    async (otherUserId: string): Promise<Conversation | null> => {
      try {
        const privateKey = cryptoKeyCache.getPrivateKey();
        if (!privateKey) throw new Error('Encryption keys not unlocked');

        const existing = await chatService.findDirectConversation(otherUserId);
        if (existing) {
          const conv = await chatService.getConversationWithMembers(existing);
          if (conv) return conv.conversation;
        }

        const [myPubKey, otherPubKey] = await Promise.all([
          encryptionKeyService.getMyKeys().then((k) => k?.publicKey),
          encryptionKeyService.getPublicKey(otherUserId),
        ]);
        if (!myPubKey || !otherPubKey) throw new Error('Missing public keys');

        const convKey = await generateConversationKey();
        const [myWrapped, otherWrapped] = await Promise.all([
          encryptConversationKeyForMember(convKey, privateKey, myPubKey),
          encryptConversationKeyForMember(convKey, privateKey, otherPubKey),
        ]);

        const conv = await chatService.createDirectConversation({
          otherUserId,
          myEncryptedKey: myWrapped.encryptedKey,
          myKeyIv: myWrapped.iv,
          otherEncryptedKey: otherWrapped.encryptedKey,
          otherKeyIv: otherWrapped.iv,
        });

        cryptoKeyCache.setConversationKey(conv.id, convKey);
        queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        return conv;
      } catch (e) {
        console.error('Failed to create conversation:', e);
        return null;
      }
    },
    [queryClient]
  );

  const createGroupConversation = useCallback(
    async (name: string, memberIds: string[]): Promise<Conversation | null> => {
      try {
        const privateKey = cryptoKeyCache.getPrivateKey();
        if (!privateKey) throw new Error('Encryption keys not unlocked');

        const pubKeys = await encryptionKeyService.getPublicKeys(memberIds);
        const pubKeyMap = new Map(pubKeys.map((pk) => [pk.userId, pk.publicKey]));

        const missingKeys = memberIds.filter((id) => !pubKeyMap.has(id));
        if (missingKeys.length > 0) {
          throw new Error(
            `Some users haven't set up encryption yet: ${missingKeys.length} user(s)`
          );
        }

        const convKey = await generateConversationKey();
        const memberKeys = await Promise.all(
          memberIds.map(async (userId) => {
            const wrapped = await encryptConversationKeyForMember(
              convKey,
              privateKey,
              pubKeyMap.get(userId)!
            );
            return { userId, encryptedKey: wrapped.encryptedKey, keyIv: wrapped.iv };
          })
        );

        const conv = await chatService.createGroupConversation({ name, memberKeys });
        cryptoKeyCache.setConversationKey(conv.id, convKey);
        queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        return conv;
      } catch (e) {
        console.error('Failed to create group:', e);
        return null;
      }
    },
    [queryClient]
  );

  const markRead = useCallback(async (messageIds: string[]) => {
    await chatService.markRead(messageIds);
  }, []);

  const addGroupMember = useCallback(
    async (
      conversationId: string,
      userId: string,
      creatorPublicKeyBase64: string
    ): Promise<boolean> => {
      try {
        const privateKey = cryptoKeyCache.getPrivateKey();
        if (!privateKey) throw new Error('Encryption keys not unlocked');

        const convKey = await getOrDecryptConversationKey(conversationId, creatorPublicKeyBase64);
        const memberPubKey = await encryptionKeyService.getPublicKey(userId);
        if (!memberPubKey) throw new Error('User has no encryption keys');

        const rawKey = await crypto.subtle.exportKey('raw', convKey);
        const reImported = await crypto.subtle.importKey(
          'raw',
          rawKey,
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
        const wrapped = await encryptConversationKeyForMember(reImported, privateKey, memberPubKey);

        await chatService.addMember(conversationId, {
          userId,
          encryptedKey: wrapped.encryptedKey,
          keyIv: wrapped.iv,
        });
        queryClient.invalidateQueries({ queryKey: ['chat', 'members', conversationId] });
        return true;
      } catch (e) {
        console.error('Failed to add member:', e);
        return false;
      }
    },
    [queryClient]
  );

  const removeGroupMember = useCallback(
    async (conversationId: string, userId: string): Promise<boolean> => {
      try {
        const ok = await chatService.removeMember(conversationId, userId);
        if (ok) {
          cryptoKeyCache.removeConversationKey(conversationId);
          queryClient.invalidateQueries({ queryKey: ['chat', 'members', conversationId] });
        }
        return ok;
      } catch (e) {
        console.error('Failed to remove member:', e);
        return false;
      }
    },
    [queryClient]
  );

  return {
    sendTextMessage,
    sendFileMessage,
    createDirectConversation,
    createGroupConversation,
    markRead,
    addGroupMember,
    removeGroupMember,
  };
}
