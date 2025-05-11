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

const cleanupPrimaryUrl = (primaryUrl) => {
  // Remove possible http(s)://www. from the primary_url, and strip any trailing slashes
  return primaryUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

const searchMurmurationsAPI = async (primaryUrl, index = 'test') => {
  primaryUrl = cleanupPrimaryUrl(primaryUrl);

  console.log(`\n\nSearching Murmurations ${index} API for primary URL = ${primaryUrl}`);
  const queryParams = new URLSearchParams({
    primary_url: primaryUrl,
    schema: 'organizations_schema-v1.0.0'
  }).toString();

  const apiUrl = `https://${index === 'test' ? 'test-' : ''}index.murmurations.network/v2/nodes?${queryParams}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to query Murmurations API for ${primaryUrl}`);
  }

  const nodesData = await response.json();
  const activeNodes = nodesData.data?.filter(n => n.status !== 'deleted');
  // If there are multiple nodes with the same primary_url, use the one where the profile_url matches the primaryUrl
  let node = activeNodes.find(n => n.profile_url.includes(primaryUrl)) || activeNodes?.[0];
  console.log('Found murmurations profile: ', node);
  return node;
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
    const primaryUrl = cleanupPrimaryUrl(murmurationsData.primary_url);
    const relationshipUrls = murmurationsData.relationships?.map(rel => rel.object_url) || [];

    const murmurationsElements = [convertMurmurationsProfileToKumuElement(murmurationsData)];

    for (const relUrl of relationshipUrls) {
      try {
        const node = await searchMurmurationsAPI(relUrl, index || 'test');
        if (!node) continue;

        const profileData = await getDataFromUrl(node.profile_url);
        const hasRelationshipToPrimaryProfile = profileData?.relationships?.some(r => r.object_url.includes(primaryUrl));

        if (hasRelationshipToPrimaryProfile) {
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