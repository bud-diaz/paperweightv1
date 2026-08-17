import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { PlayerDrawer } from '@/components/PlayerDrawer';
import { StickyTransportBar } from '@/components/StickyTransportBar';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const colors = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.background },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Discover',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'compass' : 'compass-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="play"
          options={{
            title: 'Play',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'play-circle' : 'play-circle-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="stack"
          options={{
            title: 'Stack',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'layers' : 'layers-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="studio"
          options={{
            title: 'Studio',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'options' : 'options-outline'} color={color} size={size} />
            ),
          }}
        />
      </Tabs>

      {/*
        Mounted as siblings of <Tabs>, not inside any one screen, so both
        survive tab switches instead of remounting per screen.
      */}
      <StickyTransportBar />
      <PlayerDrawer />
    </View>
  );
}
