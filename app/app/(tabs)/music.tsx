import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, SafeAreaView, FlatList } from 'react-native';
import { usePipecatClient, usePipecatClientEvent } from '@pipecat-ai/client-react';
import { Sparkles, Music, Play, RotateCw } from 'lucide-react-native';
import Animated, { FadeInRight, BounceIn } from 'react-native-reanimated';

interface Proposal {
  track: string;
  reason: string;
}

export default function MusicScreen() {
  const client = usePipecatClient();
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([
    { track: "Dungeon_Ambiance.mp3", reason: "O clima está sombrio e úmido." },
    { track: "Combat_Slow.wav", reason: "Possível tensão crescendo no diálogo." }
  ]);

  // Listen for music proposals from the bot
  // RTVI supports custom app messages
  usePipecatClientEvent('onAppMessage', (msg: any) => {
    if (msg.type === 'music_proposal') {
      setProposals(prev => [msg.data, ...prev].slice(0, 5));
    }
  });

  const playTrack = (track: string) => {
    setCurrentTrack(track);
    // Send command to bot to play local file
    client.sendMessage({
      type: 'play_music',
      data: { track }
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.nowPlaying}>
        <Text style={styles.sectionTitle}>TOCANDO AGORA</Text>
        <View style={styles.trackCard}>
          <Music size={32} color={currentTrack ? "#A855F7" : "#4B5563"} />
          <View style={styles.trackInfo}>
            <Text style={styles.trackName}>{currentTrack || "Silêncio..."}</Text>
            <Text style={styles.trackStatus}>{currentTrack ? "Em loop" : "Selecione uma trilha"}</Text>
          </View>
        </View>
      </View>

      <View style={styles.proposals}>
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>PROPOSTAS DA IA</Text>
          <Sparkles size={16} color="#FBBF24" />
        </View>
        
        <ScrollView style={styles.proposalList}>
          {proposals.map((p, i) => (
            <Animated.View key={i} entering={FadeInRight.delay(i * 100)} style={styles.proposalCard}>
              <View style={styles.proposalInfo}>
                <Text style={styles.proposalTrack}>{p.track}</Text>
                <Text style={styles.proposalReason}>"{p.reason}"</Text>
              </View>
              <TouchableOpacity style={styles.playBtn} onPress={() => playTrack(p.track)}>
                <Play size={20} color="white" fill="white" />
              </TouchableOpacity>
            </Animated.View>
          ))}
        </ScrollView>
      </View>

      <TouchableOpacity style={styles.refreshBtn}>
        <RotateCw size={24} color="white" />
        <Text style={styles.refreshText}>Scanear Pasta de Músicas</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 20,
  },
  nowPlaying: {
    marginBottom: 30,
  },
  sectionTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 12,
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  trackInfo: {
    marginLeft: 16,
  },
  trackName: {
    color: '#F9FAFB',
    fontSize: 18,
    fontWeight: '700',
  },
  trackStatus: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 4,
  },
  proposals: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  proposalList: {
    flex: 1,
  },
  proposalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  proposalInfo: {
    flex: 1,
  },
  proposalTrack: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '600',
  },
  proposalReason: {
    color: '#94A3B8',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 4,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    padding: 16,
    borderRadius: 20,
    marginTop: 20,
    gap: 10,
  },
  refreshText: {
    color: 'white',
    fontWeight: 'bold',
  }
});
