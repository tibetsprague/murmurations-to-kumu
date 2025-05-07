import fetch from 'node-fetch';

const getDataFromUrl = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return response.json();
};

const convertMurmurationsProfileToKumuElement = (profile) => ({
  description: profile.description,
  id: profile.id,
  image: profile.image,
  label: profile.name,
  location: profile.full_address,
  mission: profile.mission,
  type: 'organization',
  url: profile.primary_url
});

const searchMurmurationsAPI = async (primaryUrl, index = 'test') => {
  primaryUrl = primaryUrl.replace(/^https?:\/\//, '');
  const queryParams = new URLSearchParams({
    primary_url: primaryUrl,
    schema: 'organizations_schema-v1.0.0'
  }).toString();

  const apiUrl = `https://${index === 'test' ? 'test-' : ''}index.murmurations.network/v2/nodes?${queryParams}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to query Murmurations API for ${primaryUrl}`);
  }
  return response.json();
};

export default async function handler(req, res) {
  const { url, index } = req.query;

  // For CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!url) {
    return res.status(400).json({ error: 'Missing `url` query parameter' });
  }

  try {
    const murmurationsData = await getDataFromUrl(url);
    const relationshipUrls = murmurationsData.relationships?.map(rel => rel.object_url) || [];

    const murmurationsElements = [convertMurmurationsProfileToKumuElement(murmurationsData)];

    for (const relUrl of relationshipUrls) {
      try {
        const nodesData = await searchMurmurationsAPI(relUrl, index || 'test');
        const node = nodesData.data?.[0];
        if (!node) continue;

        const profileData = await getDataFromUrl(node.profile_url);
        const hasRelationshipToCTA = profileData?.relationships?.some(r => r.object_url.includes('collaborative.tech'));

        if (hasRelationshipToCTA) {
          murmurationsElements.push(convertMurmurationsProfileToKumuElement(profileData));
        }
      } catch (e) {
        console.warn(`Skipping related URL ${relUrl}: ${e.message}`);
        continue;
      }
    }

    const connections = murmurationsElements
      .filter(node => node.label !== murmurationsElements[0].label)
      .map(node => ({
        from: node.label,
        to: murmurationsElements[0].label
      }));

    const kumuMap = {
      elements: murmurationsElements,
      connections,
      loops: []
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(kumuMap);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}