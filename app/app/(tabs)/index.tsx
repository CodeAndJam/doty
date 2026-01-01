import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { usePipecatClient } from '@pipecat-ai/client-react';
import { Play, Square, Mic } from 'lucide-react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

export default function TranscriptionScreen() {
  const client = usePipecatClient();
  const [status, setStatus] = useState('idle');
  const [transcriptions, setTranscriptions] = useState<string[]>([]);

  useEffect(() => {
    if (!client) return;

    const handleTranscription = (data: any) => {
      if (data.final) {
        setTranscriptions(prev => [...prev, data.text]);
      }
    };

    client.on('transcription', handleTranscription);
    return () => {
      client.off('transcription', handleTranscription);
    };
  }, [client]);

  const toggleSession = async () => {
    if (!client) return;

    if (status === 'idle') {
      try {
        setStatus('connecting');
        
        // 1. Tell the server to start the bot
        const roomUrl = "https://your-room.daily.co/gm-assistant"; 
        const serverUrl = "http://localhost:8000"; 
        
        await fetch(`${serverUrl}/start_bot?room_url=${encodeURIComponent(roomUrl)}`, {
          method: 'POST'
        });

        // 2. Connect the client to the room
        await client.connect({
          roomUrl: roomUrl
        });
        
        setStatus('recording');
      } catch (e) {
        console.error("Connection failed:", e);
        setStatus('idle');
      }
    } else {
      await client.disconnect();
      setStatus('idle');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: status === 'recording' ? '#EF4444' : '#6B7280' }]} />
          <Text style={styles.statusText}>{status.toUpperCase()}</Text>
        </View>
        <Text style={styles.title}>Sessão de RPG</Text>
      </View>

      <ScrollView 
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
      >
        {transcriptions.length === 0 ? (
          <View style={styles.emptyState}>
            <Mic size={48} color="#4B5563" />
            <Text style={styles.emptyText}>Aguardando o início da aventura...</Text>
          </View>
        ) : (
          transcriptions.map((t, i) => (
            <Animated.View key={i} entering={FadeInUp.delay(i * 100)} style={styles.messageRow}>
              <Text style={styles.messageText}>{t}</Text>
            </Animated.View>
          ))
        )}
      </ScrollView>

      <View style={styles.controls}>
        <TouchableOpacity 
          style={[styles.mainButton, status === 'recording' ? styles.stopButton : styles.startButton]} 
          onPress={toggleSession}
        >
          {status === 'recording' ? (
            <Square size={32} color="white" />
          ) : (
            <Play size={32} color="white" fill="white" />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 24,
    fontWeight: '900',
  },
  transcriptArea: {
    flex: 1,
    paddingHorizontal: 20,
  },
  transcriptContent: {
    paddingVertical: 20,
  },
  messageRow: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#A855F7',
  },
  messageText: {
    color: '#E2E8F0',
    fontSize: 16,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
  },
  emptyText: {
    color: '#6B7280',
    marginTop: 16,
    fontSize: 16,
  },
  controls: {
    padding: 30,
    alignItems: 'center',
  },
  mainButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: '#8B5CF6',
  },
  stopButton: {
    backgroundColor: '#EF4444',
  }
});
