/**
 * WebRTC Video Chat Client Library
 * Handles peer-to-peer video/audio connections via WebRTC
 * Uses Socket.io for signaling
 */

class VideoChat {
    constructor(config) {
        this.socket = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.roomId = null;
        this.userId = String(config.userId);
        this.role = config.role;
        this.userName = config.userName;
        this.serverUrl = config.serverUrl || 'http://localhost:3001';

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
     * Initialize the video chat - connect to signaling server
     */
    async initialize() {
        try {
            // Load Socket.io client library
            if (typeof io === 'undefined') {
                throw new Error('Socket.io client library not loaded');
            }

            // Connect to signaling server
            this.socket = io(this.serverUrl);

            this.socket.on('connect', () => {
                console.log('✅ Connected to signaling server');
                // Register with server
                this.socket.emit('user:join', {
                    userId: this.userId,
                    role: this.role,
                    name: this.userName
                });
            });

            // Handle incoming call
            this.socket.on('call:incoming', (data) => {
                this.onCallIncoming({
                    callerId: data.callerId,
                    callerName: data.callerName,
                    callerRole: data.callerRole,
                    roomId: data.roomId
                });
            });

            // Handle call accepted
            this.socket.on('call:accepted', async ({ roomId }) => {
                console.log('✅ Call accepted');
                this.roomId = roomId;
                await this.createOffer();
            });

            // Handle call rejected
            this.socket.on('call:rejected', () => {
                this.onError('Call was rejected');
                this.endCall();
            });

            // Handle call ended
            this.socket.on('call:ended', ({ reason }) => {
                console.log('Call ended:', reason);
                this.onCallEnded(reason);
                this.cleanup();
            });

            // Handle WebRTC offer
            this.socket.on('webrtc:offer', async ({ offer }) => {
                await this.handleOffer(offer);
            });

            // Handle WebRTC answer
            this.socket.on('webrtc:answer', async ({ answer }) => {
                await this.handleAnswer(answer);
            });

            // Handle ICE candidate
            this.socket.on('webrtc:ice-candidate', async ({ candidate }) => {
                await this.handleIceCandidate(candidate);
            });

            // Handle user list update
            this.socket.on('users:list', (users) => {
                this.onUserListUpdate(users);
            });

            // Handle incoming chat messages
            this.socket.on('chat:message', (data) => {
                this.onChatMessage(data);
            });

            // Handle incoming voice messages
            this.socket.on('chat:voice', (data) => {
                this.onVoiceMessage(data);
            });

            // Handle errors
            this.socket.on('call:error', ({ message }) => {
                this.onError(message);
            });

            console.log('✅ VideoChat initialized');
        } catch (error) {
            this.onError('Failed to initialize: ' + error.message);
            throw error;
        }
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
            this.roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Send initiate call signal
            this.socket.emit('call:initiate', {
                targetUserId,
                roomId: this.roomId
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
            this.roomId = roomId;

            // Start local media
            await this.startLocalMedia();

            // Send accept signal
            this.socket.emit('call:accept', { roomId });

            console.log('✅ Call accepted');
        } catch (error) {
            this.onError('Failed to accept call: ' + error.message);
            throw error;
        }
    }

    /**
     * Reject an incoming call
     */
    rejectCall(roomId) {
        this.socket.emit('call:reject', { roomId });
        console.log('❌ Call rejected');
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

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc:ice-candidate', {
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

            this.socket.emit('webrtc:offer', {
                offer,
                roomId: this.roomId
            });

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

            this.socket.emit('webrtc:answer', {
                answer,
                roomId: this.roomId
            });

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
            this.socket.emit('call:end', { roomId: this.roomId });
        }
        this.cleanup();
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

        // Clear remote stream
        this.remoteStream = null;
        this.roomId = null;

        console.log('🧹 Cleanup complete');
    }

    /**
     * Disconnect from signaling server
     */
    disconnect() {
        this.cleanup();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        console.log('👋 Disconnected from signaling server');
    }

    /**
     * Send a text chat message
     */
    sendChatMessage(message) {
        if (!this.socket || !this.roomId) return;
        const msgData = {
            roomId: this.roomId,
            message: message,
            senderName: this.userName,
            senderId: this.userId,
            type: 'text',
            timestamp: Date.now()
        };
        this.socket.emit('chat:message', msgData);
        return msgData;
    }

    /**
     * Send a voice message
     */
    sendVoiceMessage(audioBlob) {
        if (!this.socket || !this.roomId) return;
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
            this.socket.emit('chat:voice', msgData);
        };
        reader.readAsDataURL(audioBlob);
    }
}

// Ensure the class is globally available
window.VideoChat = VideoChat;
