/**
 * WebRTC Video Chat Client Library
 * Handles peer-to-peer video/audio connections via WebRTC
 * Uses Supabase Realtime Broadcast for signaling (replaces Socket.io)
 */

const SUPABASE_URL = 'https://hxruirfxplqmaosnbovg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5t5VI3IgviU5UmPVQhSfyQ_0EAui4pk';

class VideoChat {
    constructor(config) {
        this.supabase = null;
        this.channel = null;
        this.presenceChannel = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.roomId = null;
        this.userId = String(config.userId);
        this.role = config.role;
        this.userName = config.userName;

        // Callbacks
        this.onLocalStream = config.onLocalStream || (() => { });
        this.onRemoteStream = config.onRemoteStream || (() => { });
        this.onCallEnded = config.onCallEnded || (() => { });
        this.onCallIncoming = config.onCallIncoming || (() => { });
        this.onError = config.onError || ((error) => console.error('VideoChat Error:', error));
        this.onConnectionStateChange = config.onConnectionStateChange || (() => { });
        this.onUserListUpdate = config.onUserListUpdate || (() => { });
        this.onChatMessage = config.onChatMessage || (() => { });
        this.onVoiceMessage = config.onVoiceMessage || (() => { });
        this.onVideoFail = config.onVideoFail || (() => { });

        // STUN/TURN servers for NAT traversal
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }

    /**
     * Initialize Supabase Realtime signaling
     */
    async initialize() {
        try {
            // Initialize Supabase client (from CDN global)
            if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient === 'undefined') {
                throw new Error('Supabase client library not loaded. Make sure the CDN script is included.');
            }

            this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                realtime: { params: { eventsPerSecond: 20 } }
            });

            // Subscribe to the global presence channel for user list
            this.presenceChannel = this.supabase.channel('lexithera-presence', {
                config: { presence: { key: this.userId } }
            });

            this.presenceChannel
                .on('presence', { event: 'sync' }, () => {
                    const state = this.presenceChannel.presenceState();
                    const users = Object.values(state).flat().map(u => ({
                        userId: u.userId,
                        name: u.name,
                        role: u.role,
                        inCall: u.inCall || false
                    }));
                    this.onUserListUpdate(users);
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        await this.presenceChannel.track({
                            userId: this.userId,
                            name: this.userName,
                            role: this.role,
                            inCall: false
                        });
                        console.log('✅ Connected to Supabase Realtime (presence)');
                    }
                });

            // Subscribe to the personal signaling channel (to receive incoming call invitations)
            const personalChannel = this.supabase.channel(`user-${this.userId}`);
            personalChannel
                .on('broadcast', { event: 'call:incoming' }, ({ payload }) => {
                    this.onCallIncoming({
                        callerId: payload.callerId,
                        callerName: payload.callerName,
                        callerRole: payload.callerRole,
                        roomId: payload.roomId
                    });
                })
                .subscribe();

            this._personalChannel = personalChannel;

            console.log('✅ VideoChat initialized with Supabase Realtime');
        } catch (error) {
            this.onError('Failed to initialize: ' + error.message);
            throw error;
        }
    }

    /**
     * Join a signaling room channel and set up WebRTC event listeners
     */
    async _joinRoomChannel(roomId) {
        // Leave old channel if any
        if (this.channel) {
            await this.supabase.removeChannel(this.channel);
        }

        this.roomId = roomId;
        this.channel = this.supabase.channel(`room-${roomId}`, {
            config: { broadcast: { self: false } }
        });

        this.channel
            .on('broadcast', { event: 'call:accepted' }, async ({ payload }) => {
                console.log('✅ Call accepted');
                await this.createOffer();
            })
            .on('broadcast', { event: 'call:rejected' }, () => {
                this.onError('Call was rejected');
                this.endCall();
            })
            .on('broadcast', { event: 'call:ended' }, ({ payload }) => {
                console.log('Call ended:', payload.reason);
                this.onCallEnded(payload.reason);
                this.cleanup();
            })
            .on('broadcast', { event: 'webrtc:offer' }, async ({ payload }) => {
                await this.handleOffer(payload.offer);
            })
            .on('broadcast', { event: 'webrtc:answer' }, async ({ payload }) => {
                await this.handleAnswer(payload.answer);
            })
            .on('broadcast', { event: 'webrtc:ice-candidate' }, async ({ payload }) => {
                await this.handleIceCandidate(payload.candidate);
            })
            .on('broadcast', { event: 'chat:message' }, ({ payload }) => {
                this.onChatMessage(payload);
            })
            .on('broadcast', { event: 'chat:voice' }, ({ payload }) => {
                this.onVoiceMessage(payload);
            })
            .subscribe();
    }

    /**
     * Send a broadcast event on the room channel
     */
    _sendToRoom(event, payload) {
        if (!this.channel) return;
        this.channel.send({ type: 'broadcast', event, payload });
    }

    /**
     * Send a broadcast event to a specific user's personal channel
     */
    _sendToUser(targetUserId, event, payload) {
        const targetChannel = this.supabase.channel(`user-${targetUserId}`);
        // We need to subscribe briefly, send, then remove
        targetChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                targetChannel.send({ type: 'broadcast', event, payload });
                // Brief delay then cleanup
                setTimeout(() => this.supabase.removeChannel(targetChannel), 1000);
            }
        });
    }

    /**
     * Start local media (camera and microphone)
     */
    async startLocalMedia(constraints = { video: true, audio: true }) {
        try {
            console.log('🎬 Starting local media with constraints:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.onLocalStream(this.localStream);
            console.log('✅ Local media started');
            return this.localStream;
        } catch (error) {
            console.error('❌ startLocalMedia error:', error);

            // If video failed but audio was requested, try audio-only fallback
            if (constraints.video && constraints.audio) {
                console.warn('⚠️ Video source failed, attempting audio-only fallback...');
                try {
                    this.onVideoFail(error.message);
                    const audioOnlyConstraints = { video: false, audio: true };
                    this.localStream = await navigator.mediaDevices.getUserMedia(audioOnlyConstraints);
                    this.onLocalStream(this.localStream);
                    console.log('✅ Audio-only media started as fallback');
                    return this.localStream;
                } catch (audioError) {
                    this.onError('Failed to access both camera and microphone: ' + audioError.message);
                    throw audioError;
                }
            }

            this.onError('Failed to access media: ' + error.message);
            throw error;
        }
    }

    /**
     * Initiate a call to another user
     */
    async initiateCall(targetUserId) {
        try {
            // Start local media first
            await this.startLocalMedia();

            // Generate room ID
            const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Join the room channel to listen for accepted/rejected signals
            await this._joinRoomChannel(roomId);

            // Update presence to show we're in a call
            await this.presenceChannel.track({
                userId: this.userId,
                name: this.userName,
                role: this.role,
                inCall: true
            });

            // Send call:incoming signal directly to the target user's personal channel
            this._sendToUser(targetUserId, 'call:incoming', {
                callerId: this.userId,
                callerName: this.userName,
                callerRole: this.role,
                roomId
            });

            console.log('📞 Call initiated to:', targetUserId);
        } catch (error) {
            this.onError('Failed to initiate call: ' + error.message);
            throw error;
        }
    }

    /**
     * Accept an incoming call
     */
    async acceptCall(roomId) {
        try {
            // Start local media
            await this.startLocalMedia();

            // Join the room channel
            await this._joinRoomChannel(roomId);

            // Update presence
            await this.presenceChannel.track({
                userId: this.userId,
                name: this.userName,
                role: this.role,
                inCall: true
            });

            // Notify the room that call is accepted
            this._sendToRoom('call:accepted', { roomId });

            console.log('✅ Call accepted');
        } catch (error) {
            this.onError('Failed to accept call: ' + error.message);
            throw error;
        }
    }

    /**
     * Reject an incoming call
     */
    async rejectCall(roomId) {
        // Briefly join the room just to send rejected signal
        await this._joinRoomChannel(roomId);
        this._sendToRoom('call:rejected', { roomId });
        console.log('❌ Call rejected');
        // Leave the room
        if (this.channel) {
            await this.supabase.removeChannel(this.channel);
            this.channel = null;
            this.roomId = null;
        }
    }

    /**
     * Create peer connection
     */
    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection({
            iceServers: this.iceServers
        });

        // Add local stream tracks to peer connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            if (!this.remoteStream) {
                this.remoteStream = new MediaStream();
                this.onRemoteStream(this.remoteStream);
            }
            this.remoteStream.addTrack(event.track);
            console.log('🎥 Remote track added:', event.track.kind);
        };

        // Handle ICE candidates — send via Supabase
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this._sendToRoom('webrtc:ice-candidate', {
                    candidate: event.candidate,
                    roomId: this.roomId
                });
            }
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            this.onConnectionStateChange(this.peerConnection.connectionState);

            if (this.peerConnection.connectionState === 'failed') {
                this.onError('Connection failed');
            }
        };

        console.log('✅ Peer connection created');
    }

    /**
     * Create and send WebRTC offer
     */
    async createOffer() {
        try {
            this.createPeerConnection();

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            this._sendToRoom('webrtc:offer', { offer, roomId: this.roomId });

            console.log('📤 Offer sent');
        } catch (error) {
            this.onError('Failed to create offer: ' + error.message);
            throw error;
        }
    }

    /**
     * Handle incoming WebRTC offer
     */
    async handleOffer(offer) {
        try {
            if (!this.peerConnection) {
                this.createPeerConnection();
            }

            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this._sendToRoom('webrtc:answer', { answer, roomId: this.roomId });

            console.log('📥 Offer received, answer sent');
        } catch (error) {
            this.onError('Failed to handle offer: ' + error.message);
            throw error;
        }
    }

    /**
     * Handle incoming WebRTC answer
     */
    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ Answer received');
        } catch (error) {
            this.onError('Failed to handle answer: ' + error.message);
            throw error;
        }
    }

    /**
     * Handle incoming ICE candidate
     */
    async handleIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('Failed to add ICE candidate:', error);
        }
    }

    /**
     * Toggle local audio
     */
    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                return audioTrack.enabled;
            }
        }
        return false;
    }

    /**
     * Toggle local video
     */
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                return videoTrack.enabled;
            }
        }
        return false;
    }

    /**
     * End the call
     */
    endCall() {
        if (this.roomId) {
            this._sendToRoom('call:ended', { roomId: this.roomId, reason: 'User ended call' });
        }
        this.cleanup();
        // Update presence — no longer in call
        if (this.presenceChannel) {
            this.presenceChannel.track({
                userId: this.userId,
                name: this.userName,
                role: this.role,
                inCall: false
            });
        }
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        // Stop local media
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Leave room channel
        if (this.channel && this.supabase) {
            this.supabase.removeChannel(this.channel);
            this.channel = null;
        }

        this.remoteStream = null;
        this.roomId = null;

        console.log('🧹 Cleanup complete');
    }

    /**
     * Disconnect from signaling server
     */
    disconnect() {
        this.cleanup();
        if (this.presenceChannel && this.supabase) {
            this.supabase.removeChannel(this.presenceChannel);
            this.presenceChannel = null;
        }
        if (this._personalChannel && this.supabase) {
            this.supabase.removeChannel(this._personalChannel);
            this._personalChannel = null;
        }
        console.log('👋 Disconnected from Supabase Realtime');
    }

    /**
     * Send a text chat message
     */
    sendChatMessage(message) {
        if (!this.channel || !this.roomId) return;
        const msgData = {
            roomId: this.roomId,
            message: message,
            senderName: this.userName,
            senderId: this.userId,
            type: 'text',
            timestamp: Date.now()
        };
        this._sendToRoom('chat:message', msgData);
        return msgData;
    }

    /**
     * Send a voice message
     */
    sendVoiceMessage(audioBlob) {
        if (!this.channel || !this.roomId) return;
        const reader = new FileReader();
        reader.onload = () => {
            const msgData = {
                roomId: this.roomId,
                audioData: reader.result, // base64
                senderName: this.userName,
                senderId: this.userId,
                type: 'voice',
                timestamp: Date.now()
            };
            this._sendToRoom('chat:voice', msgData);
        };
        reader.readAsDataURL(audioBlob);
    }
}

// Ensure the class is globally available
window.VideoChat = VideoChat;
