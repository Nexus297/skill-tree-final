import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Legacy migration helper to ensure old maps don't break
// Legacy migration helper to teleport old nodes to the new center
const migrateNode = (node) => {
  let newNode = { ...node };

  // 1. Upgrade single parent to multiple parents
  if (newNode.parentId !== undefined) {
    newNode.parentIds = newNode.parentId ? [newNode.parentId] : [];
    delete newNode.parentId;
  }

  // 2. Teleport legacy nodes (coordinates < 1000) to the new camera center
  if (newNode.x < 1000) newNode.x += 1600;
  if (newNode.y < 1000) newNode.y += 1700;

  return newNode;
};

// Shifted coordinates to center them in the new 4000x4000 canvas
const DEFAULT_MAPS = [
  {
    id: 'map_1',
    name: 'Web Dev Mastery',
    nodes: [
      { id: '1', label: 'Web Basics', x: 1900, y: 1800, parentIds: [], status: 'mastered', desc: 'HTML, CSS, Internet architecture' },
      { id: '2', label: 'JS Fundamentals', x: 2100, y: 1800, parentIds: [], status: 'progress', desc: 'Loops, Variables, Functions' },
      { id: '3', label: 'React JS', x: 2000, y: 1950, parentIds: ['1', '2'], status: 'progress', desc: 'Requires both Web Basics and JS' },
    ]
  }
];

const EMPTY_FORM = { label: '', parentIds: [], status: 'progress', desc: '' };

export default function App() {
  const [appData, setAppData] = useState(() => {
    const saved = localStorage.getItem('skillTreeAppData');
    if (saved) {
      const parsed = JSON.parse(saved);
      parsed.maps = parsed.maps.map(map => ({ ...map, nodes: map.nodes.map(migrateNode) }));
      return parsed;
    }
    return { activeMapId: 'map_1', maps: DEFAULT_MAPS };
  });

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  
  // --- Infinite Canvas State ---
  const [pan, setPan] = useState({ x: -1600, y: -1700 }); // Start looking near the center
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);

  const activeMap = appData.maps.find(m => m.id === appData.activeMapId) || appData.maps[0];
  const activeNodes = activeMap.nodes || [];

  useEffect(() => {
    localStorage.setItem('skillTreeAppData', JSON.stringify(appData));
  }, [appData]);

  // Redraw Lines
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 3;

    activeNodes.forEach(node => {
      if (node.parentIds && node.parentIds.length > 0) {
        node.parentIds.forEach(parentId => {
          const parent = activeNodes.find(n => n.id === parentId);
          if (parent) {
            ctx.beginPath();
            ctx.moveTo(parent.x + 60, parent.y + 25);
            ctx.lineTo(node.x + 60, node.y + 25);
            ctx.stroke();
          }
        });
      }
    });
  }, [activeNodes]);

  // --- Map Controls ---
  const handleCreateMap = () => {
    const name = window.prompt("Enter a name for the new skill map:");
    if (name && name.trim() !== "") {
      const newId = `map_${Date.now()}`;
      setAppData(prev => ({ activeMapId: newId, maps: [...prev.maps, { id: newId, name: name.trim(), nodes: [] }] }));
      setPan({ x: -1600, y: -1700 }); // Reset camera for new map
      setScale(1);
      cancelEdit();
    }
  };

  const handleDeleteMap = () => {
    if (appData.maps.length <= 1) return alert("You must have at least one map.");
    if (window.confirm(`Delete map "${activeMap.name}" entirely?`)) {
      setAppData(prev => {
        const newMaps = prev.maps.filter(m => m.id !== prev.activeMapId);
        return { activeMapId: newMaps[0].id, maps: newMaps };
      });
      cancelEdit();
    }
  };

  const updateActiveNodes = (updater) => {
    setAppData(prev => ({
      ...prev, maps: prev.maps.map(m => m.id === prev.activeMapId ? { ...m, nodes: typeof updater === 'function' ? updater(m.nodes) : updater } : m)
    }));
  };

  // --- Interaction Engine (Pan, Zoom, Drag) ---
  const handleWheel = (e) => {
    e.preventDefault(); 
    
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    
    // 1. Calculate the new scale (clamped between 0.2x and 2.5x)
    const newScale = Math.min(Math.max(0.2, scale + delta), 2.5);
    
    // 2. If we are already at max/min zoom, do nothing to prevent map drifting
    if (newScale === scale) return;

    // 3. Get exact mouse coordinates relative to the viewport window
    const rect = viewportRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 4. Calculate where the mouse is pointing on the raw, unscaled canvas
    const canvasX = (mouseX - pan.x) / scale;
    const canvasY = (mouseY - pan.y) / scale;

    // 5. Calculate the new Pan coordinates to keep that point under the mouse
    const newPanX = mouseX - canvasX * newScale;
    const newPanY = mouseY - canvasY * newScale;

    // 6. Update state simultaneously 
    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleBackgroundMouseDown = (e) => {
    if (e.target.closest('.node-card')) return;
    setIsPanning(true);
    cancelEdit();
  };

  const handleNodeMouseDown = (e, node) => {
    e.stopPropagation();
    setSelectedNodeId(node.id);
    setFormData({ label: node.label, parentIds: node.parentIds || [], status: node.status, desc: node.desc || '' });
    setDraggingId(node.id);

    const rect = viewportRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate exact canvas coordinates accounting for scale and pan
    const canvasX = (mouseX - pan.x) / scale;
    const canvasY = (mouseY - pan.y) / scale;
    setDragOffset({ x: canvasX - node.x, y: canvasY - node.y });
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setPan(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
    } else if (draggingId) {
      const rect = viewportRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      let newX = (mouseX - pan.x) / scale - dragOffset.x;
      let newY = (mouseY - pan.y) / scale - dragOffset.y;

      // Bound to the new massive 4000x4000 area
      newX = Math.max(0, Math.min(newX, 4000 - 120));
      newY = Math.max(0, Math.min(newY, 4000 - 50));

      updateActiveNodes(prev => prev.map(n => n.id === draggingId ? { ...n, x: newX, y: newY } : n));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingId(null);
  };

  // --- Form Logic ---
  const handleInputChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  
  const handleParentToggle = (parentId) => {
    setFormData(prev => {
      const current = prev.parentIds || [];
      return current.includes(parentId) ? { ...prev, parentIds: current.filter(id => id !== parentId) } : { ...prev, parentIds: [...current, parentId] };
    });
  };

  const cancelEdit = () => { setSelectedNodeId(null); setFormData(EMPTY_FORM); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedNodeId) {
      updateActiveNodes(prev => prev.map(n => n.id === selectedNodeId ? { ...n, ...formData } : n));
    } else {
      let newX = 2000; let newY = 2000;  
      
      if (formData.parentIds && formData.parentIds.length > 0) {
        const parents = formData.parentIds.map(id => activeNodes.find(n => n.id === id)).filter(Boolean);
        if (parents.length > 0) {
          newY = Math.max(...parents.map(p => p.y)) + 120;
          newX = parents.reduce((sum, p) => sum + p.x, 0) / parents.length;
          const siblings = activeNodes.filter(n => n.parentIds && n.parentIds.some(id => formData.parentIds.includes(id)));
          if (siblings.length > 0) newX += (siblings.length * 130);
        }
      } else {
        // Drop exactly in the middle of the user's current camera view
        newX = (400 - pan.x) / scale;
        newY = (300 - pan.y) / scale;
      }

      newX = Math.max(0, Math.min(newX, 4000 - 120));
      newY = Math.max(0, Math.min(newY, 4000 - 50));
      updateActiveNodes([...activeNodes, { id: Date.now().toString(), ...formData, x: newX, y: newY }]);
    }
    cancelEdit();
  };

  const deleteNode = () => {
    if (window.confirm("Delete this node?")) {
      updateActiveNodes(prev => prev.filter(n => n.id !== selectedNodeId).map(n => ({ ...n, parentIds: n.parentIds ? n.parentIds.filter(id => id !== selectedNodeId) : [] })));
      cancelEdit();
    }
  };

  return (
    <main className="app-container">
      <header className="app-header">
        <div className="header-titles">
          <h1>Knowledge Graph</h1>
          <p>Interactive skill tree builder.</p>
        </div>
        <div className="map-controls">
          <select value={appData.activeMapId} onChange={(e) => { setAppData(prev => ({ ...prev, activeMapId: e.target.value })); cancelEdit(); }}>
            {appData.maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="btn-secondary btn-action" onClick={handleCreateMap}>+ New Map</button>
          <button className="btn-danger btn-action outline" onClick={handleDeleteMap}>Delete</button>
        </div>
      </header>

      <div className="layout-grid">
        {/* The Viewport */}
        <section 
          className="tree-visualizer" 
          ref={viewportRef}
          onWheel={handleWheel}
          onMouseDown={handleBackgroundMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="canvas-hint">Scroll to Zoom • Drag to Pan</div>
          
          {/* The Infinite Canvas Container */}
          <div 
            className="canvas-container"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          >
            <canvas ref={canvasRef} width={4000} height={4000} className="tree-canvas" />
            
            {activeNodes.map(node => (
              <div 
                key={node.id} 
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                className={`node-card status-${node.status} ${selectedNodeId === node.id ? 'selected' : ''}`}
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
              >
                <span>{node.label}</span>
                {draggingId !== node.id && !isPanning && (
                  <div className="tooltip">
                    <strong>{node.label}</strong>
                    <p>{node.desc || 'No description provided.'}</p>
                    <span className={`badge badge-${node.status}`}>{node.status.toUpperCase()}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Form Control Panel */}
        <aside className="control-panel">
          <form onSubmit={handleSubmit}>
            <fieldset>
              <legend>{selectedNodeId ? 'Inspect Node' : 'Initialize Node'}</legend>
              <div className="form-group">
                <label>Skill Name</label>
                <input type="text" name="label" value={formData.label} onChange={handleInputChange} required placeholder="e.g. React Router" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea name="desc" value={formData.desc} onChange={handleInputChange} rows="2" placeholder="Core concepts..."></textarea>
              </div>
              
              <div className="form-group">
                <label>Prerequisites (Multiple Allowed)</label>
                <div className="multi-select-list">
                  {activeNodes.filter(n => n.id !== selectedNodeId).length === 0 && (
                     <span className="empty-text">No other nodes available.</span>
                  )}
                  {activeNodes.filter(n => n.id !== selectedNodeId).map(n => (
                    <label key={n.id} className="checkbox-label">
                      <input 
                        type="checkbox" 
                        checked={(formData.parentIds || []).includes(n.id)}
                        onChange={() => handleParentToggle(n.id)}
                      />
                      {n.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Proficiency Status</label>
                <div className="radio-group">
                  <label><input type="radio" name="status" value="progress" checked={formData.status === 'progress'} onChange={handleInputChange} /> In Progress</label>
                  <label><input type="radio" name="status" value="mastered" checked={formData.status === 'mastered'} onChange={handleInputChange} /> Mastered</label>
                </div>
              </div>
              <div className="button-group">
                <button type="submit" className="btn-primary">{selectedNodeId ? 'Commit Update' : 'Append Node'}</button>
                {selectedNodeId && <button type="button" onClick={cancelEdit} className="btn-secondary">Deselect</button>}
              </div>
            </fieldset>
          </form>
          {selectedNodeId && <button onClick={deleteNode} className="btn-danger outline">Remove Node</button>}
        </aside>
      </div>
    </main>
  );
}