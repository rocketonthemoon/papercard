//! Random texts for duels. Each one hides mistakes that Harper (and the Harper.px extras) can find.
//! `cargo test` checks that every text has at least 4, that deleting it scores 0,
//! and that applying Harper's fixes scores well.

pub struct Passage {
    pub title: &'static str,
    pub text: &'static str,
}

pub const PASSAGES: &[Passage] = &[
    Passage {
        title: "The camping trip",
        text: "Me and him went camping last weekend. We was hoping for sun, but it rained alot. Their was mud everywhere and I could of stayed home. Still, it was a once in a lifetime experience and I definately want to go again.",
    },
    Passage {
        title: "Office memo",
        text: "Please make sure everyone have read the new policy before friday. Its important that we all follow it. If you have any question's, reply back to this email. Thanks for you're patience.",
    },
    Passage {
        title: "Restaurant review",
        text: "The food was suppose to be the best in town, but it was more worse then I expected. The waiter didn't brought our drinks for twenty minutes. There is many better places near by, so I wont be back.",
    },
    Passage {
        title: "Job application",
        text: "I am writing to apply for the position of manager. I have went to many trainings and I am use to work under pressure. I look forward to hear from you. Your welcome to contact me any time.",
    },
    Passage {
        title: "Science class",
        text: "The affect of the sun on plants are very strong. Each of the students have a plant on there desk. We seen that the plants near the window grew more faster. Less plants survived in the dark corner.",
    },
    Passage {
        title: "A lost dog",
        text: "Yesterday my dog runned away. I looked everywhere but I could not find him. A neighbour said he seen a dog near the park. Me and my sister went their and we found him laying down under a tree.",
    },
    Passage {
        title: "Birthday party",
        text: "Thanks for coming to my party! It was a unexpected surprise to see so many friends. Between you and I, the cake was to sweet. Lets do it again next year, and next time I will bake it myself.",
    },
    Passage {
        title: "Travel blog",
        text: "Paris is a city who's beauty is hard to describe. We walked along the river everyday and eat croissants for breakfast. The museums was amazing, but the lines was very long. I would of stayed longer if I could.",
    },
    Passage {
        title: "Group project",
        text: "Our group have finished the first part of the project. One of my teammates are still working on the slides. We need to discuss about the final outcome tomorrow. Please explain me what you want us to change.",
    },
    Passage {
        title: "Weekend plans",
        text: "This weekend I want to relax and do nothing. I enjoy to read books and I could care less about the news. My friend wants to go to the beach, but it is suppose to rain. Me and her will decide tomorrow.",
    },
    Passage {
        title: "Customer complaint",
        text: "I bought a laptop from you're store last month. It have stopped working after two weeks. The screen flickers and the battery dont charge. I seen the same problem in many reviews. I expect a full refund irregardless of your return policy.",
    },
    Passage {
        title: "Football match",
        text: "The match was really exiting. Our team scored three goals in the second half. The other team played good, but they made to many mistakes. The fans was singing untill the very end.",
    },
    Passage {
        title: "Learning to cook",
        text: "I use to burn everything I cooked. Now I can makes a simple pasta and a nice salad. The trick is to not loose your patience. My mom gave me alot of advices and I'm finally getting better.",
    },
    Passage {
        title: "Moving house",
        text: "We moved to a new apartment last month. The children is happy because they have there own rooms now. Unpacking all the boxes took alot of time. Their are still a few boxes in the hallway that nobody have opened.",
    },
    Passage {
        title: "Movie night",
        text: "Last night we watched a old movie. The story was a little slow, but the actors was great. Whose going to pick the movie next time? I suggest you to choose a comedy, because I could use a good laugh.",
    },
    Passage {
        title: "Gym diary",
        text: "I went to the gym three times this week. My trainer made me to do one hundred squats. There was many people watching me. I feel badly that I skipped leg day for so long, and tomorrow I will be in alot of pain.",
    },
];
