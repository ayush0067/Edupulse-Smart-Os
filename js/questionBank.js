const makeQ = (id, subject, difficulty, xp, title, prompt, options, answerIndex, explanation) => ({
  id, subject, difficulty, xp, title, prompt, options, answerIndex, explanation, solved: false
});

function getInitialBTechQuestions() {
  return [
    makeQ('dsa1','DSA','Easy',40,'Binary Search Time','Worst-case time complexity of Binary Search on n sorted elements?',['O(n)','O(log n)','O(n log n)','O(1)'],1,'Binary search halves the search space each step: O(log n).'),
    makeQ('dsa2','DSA','Easy',40,'BFS Data Structure','Which data structure is used to implement Breadth-First Search (BFS)?',['Stack','Queue','Priority Queue','Trie'],1,'BFS explores level by level using FIFO order (Queue).'),
    makeQ('dsa3','DSA','Easy',40,'DFS Data Structure','Which data structure is implicitly used by recursive Depth-First Search?',['Queue','Call Stack','Hash Table','Heap'],1,'Recursion uses the system Call Stack (LIFO).'),
    makeQ('dsa4','DSA','Medium',50,'BST Inorder Traversal','Inorder traversal of a Binary Search Tree (BST) always produces:',['Reverse order','Sorted ascending order','Level order','Random order'],1,'Left -> Root -> Right visits BST nodes in non-decreasing order.'),
    makeQ('dsa5','DSA','Medium',50,'QuickSort Worst Case','Worst-case time complexity of QuickSort occurs when:',['Array is random','Pivot is median','Array is already sorted (bad pivot)','All elements are unique'],2,'Choosing smallest/largest pivot creates unbalanced partitions: O(n^2).'),
    makeQ('dsa6','DSA','Easy',40,'MergeSort Complexity','Worst-case time complexity of Merge Sort is:',['O(n^2)','O(n log n)','O(n)','O(log n)'],1,'Merge sort always splits in half and merges in linear time: O(n log n).'),
    makeQ('dsa7','DSA','Medium',50,'Heapify Complexity','Building a binary heap from an unsorted array of n elements takes:',['O(n log n)','O(n)','O(log n)','O(n^2)'],1,'Bottom-up heapify runs in O(n) linear time.'),
    makeQ('dsa8','DSA','Medium',50,'AVL Tree Balance','In an AVL tree, the allowed balance factor for any node is:',['-2, -1, 0, 1, 2','-1, 0, 1','0, 1','Any integer'],1,'Height difference between left and right subtrees must be at most 1.'),
    makeQ('dsa9','DSA','Medium',50,'Dijkstra Limitation','Dijkstra shortest path algorithm fails when a graph has:',['Cycles','Disconnected nodes','Negative edge weights','Undirected edges'],2,'Greedy relaxation assumes path lengths only increase, failing on negative edges.'),
    makeQ('dsa10','DSA','Hard',70,'Bellman-Ford Use','Which algorithm detects negative weight cycles in a directed graph?',['Prim','Kruskal','Bellman-Ford','Floyd-Warshall only'],2,'Bellman-Ford relaxes edges V-1 times; a V-th relaxation indicates a negative cycle.'),
    makeQ('m1','Engg Math','Medium',50,'Partial Derivative','If f(x, y) = 3x^2*y + 4y^3, find df/dx:',['6xy','6xy + 12y^2','3x^2 + 12y^2','6x'],0,'Treat y as constant: d/dx(3x^2*y) = 6xy.'),
    makeQ('m2','Engg Math','Medium',50,'PDE Classification','The 1D Heat Equation du/dt = c^2 d^2u/dx^2 is classified as:',['Elliptic','Parabolic','Hyperbolic','Linear algebraic'],1,'B^2 - 4AC = 0 makes the heat equation parabolic.'),
    makeQ('m3','Engg Math','Medium',50,'Wave Equation Type','The 1D Wave Equation d^2u/dt^2 = c^2 d^2u/dx^2 is:',['Parabolic','Elliptic','Hyperbolic','Nonlinear'],2,'B^2 - 4AC > 0 classifies the wave equation as hyperbolic.'),
    makeQ('m4','Engg Math','Medium',50,'Laplace Equation','d^2u/dx^2 + d^2u/dy^2 = 0 is classified as:',['Elliptic','Parabolic','Hyperbolic','First-order'],0,'B^2 - 4AC < 0 makes Laplace equation elliptic.'),
    makeQ('m5','Engg Math','Easy',40,'Laplace of 1','What is the Laplace Transform L{1} for s > 0?',['1','1/s','1/s^2','s'],1,'Integral of e^(-st) dt from 0 to infinity = 1/s.'),
    makeQ('m6','Engg Math','Medium',50,'Eigenvalue Sum','The sum of all eigenvalues of a square matrix equals its:',['Determinant','Trace','Rank','Inverse'],1,'Sum of eigenvalues = Trace (sum of main diagonal elements).'),
    makeQ('m7','Engg Math','Medium',50,'Eigenvalue Product','The product of all eigenvalues of a square matrix equals its:',['Trace','Determinant','Nullity','Order'],1,'Product of eigenvalues = det(A).'),
    makeQ('m8','Engg Math','Medium',50,'Cayley-Hamilton','Cayley-Hamilton theorem states every square matrix satisfies its own:',['Transpose','Characteristic equation','Inverse','Fourier series'],1,'Substituting matrix A into its characteristic polynomial gives zero matrix.'),
    makeQ('coa1','COA','Easy',40,'Program Counter','Which CPU register holds the memory address of the NEXT instruction to be fetched?',['IR','MAR','PC (Program Counter)','MDR'],2,'The Program Counter (PC) tracks the next instruction address.'),
    makeQ('coa2','COA','Easy',40,'2s Complement','What is the 4-bit 2s complement representation of -5?',['1010','1011','1101','0101'],1,'+5 is 0101 -> invert to 1010 -> add 1 = 1011.'),
    makeQ('coa3','COA','Medium',50,'Cache Locality','Accessing elements of an array sequentially exploits:',['Temporal locality','Spatial locality','Virtual paging','Interrupts'],1,'Spatial locality means nearby memory addresses are likely accessed soon.'),
    makeQ('coa4','COA','Medium',50,'Pipeline Hazards','A RAW (Read After Write) conflict in pipelining is a:',['Structural hazard','Data hazard','Control hazard','Cache miss'],1,'RAW occurs when an instruction needs a value not yet written back.'),
    makeQ('coa5','COA','Medium',50,'DMA Advantage','Direct Memory Access (DMA) improves performance by:',['Increasing CPU clock','Transferring I/O data directly to RAM without CPU intervention','Compressing RAM','Adding cache levels'],1,'DMA offloads bulk data transfer from the CPU.'),
    makeQ('coa6','COA','Medium',50,'Booth Algorithm','Booth algorithm is used for:',['Floating point division','Signed binary multiplication','Cache mapping','Error correction'],1,'Booth algorithm multiplies signed 2s complement integers efficiently.'),
    makeQ('coa7','COA','Medium',50,'Direct Mapping','In a direct-mapped cache with 64 blocks, main memory block 130 maps to cache block:',['0','2','64','66'],1,'130 mod 64 = 2.'),
    makeQ('os1','OS & DBMS','Easy',40,'Deadlock Conditions','Which is NOT one of the 4 Coffman conditions for deadlock?',['Mutual Exclusion','Hold and Wait','Preemption','Circular Wait'],2,'Deadlock requires NO Preemption, not Preemption.'),
    makeQ('os2','OS & DBMS','Medium',50,'Banker Algorithm','Banker algorithm is used for:',['Deadlock detection','Deadlock avoidance','CPU scheduling','Disk scheduling'],1,'It checks if granting a resource keeps the system in a safe state.'),
    makeQ('os3','OS & DBMS','Medium',50,'Thrashing Cause','Thrashing in an OS occurs when:',['CPU overheats','A process spends more time paging than executing','Disk is full','Too many threads sleep'],1,'Insufficient frames cause continuous page faults.'),
    makeQ('os4','OS & DBMS','Easy',40,'ACID Properties','In DBMS transactions, the I in ACID stands for:',['Integrity','Isolation','Indexing','Iteration'],1,'ACID = Atomicity, Consistency, Isolation, Durability.'),
    makeQ('os5','OS & DBMS','Medium',50,'2NF Requirement','A relation is in Second Normal Form (2NF) if it is in 1NF and has no:',['Transitive dependencies','Partial dependencies on a composite key','Foreign keys','Null values'],1,'2NF eliminates partial dependencies on candidate keys.'),
    makeQ('os6','OS & DBMS','Medium',50,'3NF Requirement','Third Normal Form (3NF) removes:',['Multivalued dependencies','Transitive dependencies','Primary keys','Joins'],1,'3NF eliminates transitive dependencies (A -> B -> C).'),
    makeQ('os7','OS & DBMS','Hard',70,'BCNF Rule','A relation is in BCNF if for every non-trivial functional dependency X -> Y:',['Y is a prime attribute','X is a superkey','X is a foreign key','Y is atomic'],1,'Every determinant X must be a superkey in BCNF.')
  ];
}

async function fetchAIQuestions(subject, apiKey) {
  const topic = subject === 'ALL' ? '2nd Year B.Tech Computer Science (DSA, Engineering Math, COA, OS & DBMS)' : `2nd Year B.Tech ${subject}`;
  const prompt = `Generate 5 unique university-level MCQs for ${topic}. Return ONLY a valid JSON array: [{"title":"Short Title","subject":"${subject === 'ALL' ? 'DSA' : subject}","difficulty":"Medium","xp":50,"prompt":"Question?","options":["A","B","C","D"],"answerIndex":0,"explanation":"1-sentence explanation."}]`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
  });
  if (!res.ok) throw new Error('Gemini API request failed');
  const data = await res.json();
  const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
  return parsed.map((q, i) => ({ ...q, id: `ai_${Date.now()}_${i}`, solved: false }));
}
