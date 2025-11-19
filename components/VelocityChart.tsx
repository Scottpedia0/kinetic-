
import React from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { VelocityPoint } from '../types';

interface Props {
  data: VelocityPoint[];
}

export const VelocityChart: React.FC<Props> = ({ data }) => {
  // Ensure we always render something to prevent flicker, even if data is low
  const safeData = data.length > 0 ? data : [{time: '0', score: 0}, {time: '1', score: 0}];

  return (
    <div className="h-full w-full transition-opacity duration-1000 mix-blend-screen">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={safeData}>
          <defs>
            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          <YAxis hide domain={[0, 100]} />
          <Area 
            type="monotone" 
            dataKey="score" 
            stroke="#a78bfa" 
            strokeWidth={3}
            fillOpacity={1} 
            fill="url(#colorScore)" 
            filter="url(#glow)"
            isAnimationActive={true}
            animationDuration={500}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
